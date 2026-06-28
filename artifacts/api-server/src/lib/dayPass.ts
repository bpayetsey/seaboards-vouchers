/**
 * Day-pass booking engine: availability, calendar slot reservation, customer
 * self-service (assign date / reschedule / cancel) and the account-credit
 * ledger. All capacity and credit mutations are concurrency-safe:
 *
 *  - Capacity: every reservation takes a transaction-scoped Postgres advisory
 *    lock keyed on the visit date, then re-counts and inserts/updates inside the
 *    same transaction. Two concurrent bookings for the same day are serialised,
 *    so the 6-pax daily cap can never be oversold.
 *  - Credit: spending uses a single conditional decrement
 *    (… WHERE balance_minor >= amount), so the same credit can never be
 *    double-spent; posting credit upserts the balance and appends a ledger row
 *    in one transaction.
 */
import { and, eq, gte, lte, ne, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import {
  db,
  dayPassBookings,
  dayPassBlockedDates,
  accountCreditBalances,
  accountCreditEntries,
  storeOrders,
  storeInstallments,
  storeVouchers,
} from "@workspace/db";
import type { DayPassBooking, StoreOrder } from "@workspace/db";
import { SETTINGS, isDatableDayPass, paxFor } from "./storeCatalog";
import { logger } from "./logger";
import { sendVisitReminderEmail } from "./storeEmail";

export const DAY_PASS_DAILY_CAPACITY = 6;
export const MAX_RESCHEDULES = 2;
export const RESCHEDULE_MIN_HOURS = 48;
export const CANCEL_PENALTY_HOURS = 24;
/** Fraction of value kept by the resort when a penalty cancellation applies. */
export const CANCEL_PENALTY_KEPT = 0.25;

// The resort is in Seychelles (UTC+4, no DST). Calendar days and the 48h/24h
// cutoffs are anchored to that timezone so they behave identically regardless of
// where the server runs.
const MAHE_OFFSET = "+04:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00${MAHE_OFFSET}`);
  return !Number.isNaN(d.getTime());
}

/** Day of week for a calendar date (0=Sun … 2=Tue …), timezone-stable. */
function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

export function isTuesday(dateStr: string): boolean {
  return dayOfWeek(dateStr) === 2;
}

/** Today's calendar date in the resort timezone, as YYYY-MM-DD. */
export function resortToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Mahe",
  }).format(new Date());
}

export function isPast(dateStr: string): boolean {
  return dateStr < resortToday();
}

/** The instant of midnight (start of day) for a visit date, in resort time. */
function visitStartInstant(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00${MAHE_OFFSET}`);
}

/** Hours from now until the start of the visit day (negative once past). */
export function hoursUntilVisit(dateStr: string): number {
  return (visitStartInstant(dateStr).getTime() - Date.now()) / 3_600_000;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface DayAvailability {
  date: string;
  capacity: number;
  used: number;
  remaining: number;
  /** Closed by rule (Tuesday) or because the date is in the past. */
  closed: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  bookable: boolean;
}

/**
 * Availability for every calendar day in [from, to] inclusive. Reused by the
 * storefront date picker, the dashboard reschedule picker and the admin
 * calendar. `pax` (optional) is the party size being booked — when given,
 * `bookable` reflects whether that many guests still fit.
 */
export async function getAvailability(
  from: string,
  to: string,
  pax = 1,
): Promise<DayAvailability[]> {
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) return [];

  const usedRows = await db
    .select({
      date: dayPassBookings.visitDate,
      used: sql<number>`coalesce(sum(${dayPassBookings.pax}), 0)::int`,
    })
    .from(dayPassBookings)
    .where(
      and(
        eq(dayPassBookings.status, "booked"),
        isNotNull(dayPassBookings.visitDate),
        gte(dayPassBookings.visitDate, from),
        lte(dayPassBookings.visitDate, to),
      ),
    )
    .groupBy(dayPassBookings.visitDate);
  const usedByDate = new Map<string, number>();
  for (const r of usedRows) if (r.date) usedByDate.set(r.date, Number(r.used));

  const blockedRows = await db
    .select()
    .from(dayPassBlockedDates)
    .where(
      and(
        gte(dayPassBlockedDates.date, from),
        lte(dayPassBlockedDates.date, to),
      ),
    );
  const blockedByDate = new Map<string, string | null>();
  for (const b of blockedRows) blockedByDate.set(b.date, b.reason);

  const today = resortToday();
  const out: DayAvailability[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const used = usedByDate.get(d) ?? 0;
    const remaining = Math.max(0, DAY_PASS_DAILY_CAPACITY - used);
    const closed = d < today || isTuesday(d);
    const blocked = blockedByDate.has(d);
    out.push({
      date: d,
      capacity: DAY_PASS_DAILY_CAPACITY,
      used,
      remaining,
      closed,
      blocked,
      blocked_reason: blocked ? (blockedByDate.get(d) ?? null) : null,
      bookable: !closed && !blocked && remaining >= pax,
    });
    // Hard stop on absurd ranges so a bad query can't loop forever.
    if (out.length > 800) break;
  }
  return out;
}

export type ReserveReason =
  | "invalid_date"
  | "past"
  | "closed_tuesday"
  | "blocked"
  | "full";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Non-capacity reasons a date can't be booked. Capacity is checked separately. */
async function dateClosedReason(
  tx: Tx,
  dateStr: string,
): Promise<ReserveReason | null> {
  if (!isValidDateStr(dateStr)) return "invalid_date";
  if (isPast(dateStr)) return "past";
  if (isTuesday(dateStr)) return "closed_tuesday";
  const [blocked] = await tx
    .select({ date: dayPassBlockedDates.date })
    .from(dayPassBlockedDates)
    .where(eq(dayPassBlockedDates.date, dateStr));
  if (blocked) return "blocked";
  return null;
}

/**
 * Take the per-date advisory lock and return the pax already booked on that
 * date (excluding one booking id, used when moving a booking). Must run inside a
 * transaction so the lock is held until commit.
 */
async function lockAndCountDate(
  tx: Tx,
  dateStr: string,
  excludeBookingId?: string,
): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('day_pass_date'), hashtext(${dateStr}))`,
  );
  const [row] = await tx
    .select({ used: sql<number>`coalesce(sum(${dayPassBookings.pax}), 0)::int` })
    .from(dayPassBookings)
    .where(
      and(
        eq(dayPassBookings.visitDate, dateStr),
        eq(dayPassBookings.status, "booked"),
        excludeBookingId
          ? ne(dayPassBookings.id, excludeBookingId)
          : undefined,
      ),
    );
  return Number(row?.used ?? 0);
}

/**
 * Idempotently create the booking row for a paid day-pass order. Called from the
 * payment pipeline on the first successful payment. If a requested visit date is
 * no longer bookable (sold out / closed since checkout) the booking is created
 * undated so the guest can pick another day from their dashboard.
 */
export async function ensureDayPassBooking(order: StoreOrder): Promise<void> {
  if (order.type !== "day_pass") return;

  const [existing] = await db
    .select({ id: dayPassBookings.id })
    .from(dayPassBookings)
    .where(eq(dayPassBookings.orderId, order.id));
  if (existing) return;

  const pax =
    order.dayPassPax ??
    paxFor({
      productId: order.productId ?? undefined,
      type: order.type,
      adults: order.dayPassPax ?? undefined,
    }) ??
    1;
  const email = order.buyerEmail.trim().toLowerCase();
  const requested = isDatableDayPass(order.productId)
    ? order.dayPassVisitDate
    : null;

  try {
    await db.transaction(async (tx) => {
      const [again] = await tx
        .select({ id: dayPassBookings.id })
        .from(dayPassBookings)
        .where(eq(dayPassBookings.orderId, order.id));
      if (again) return;

      let finalDate: string | null = requested ?? null;
      if (finalDate) {
        const reason = await dateClosedReason(tx, finalDate);
        if (reason) {
          finalDate = null;
        } else {
          const used = await lockAndCountDate(tx, finalDate);
          if (used + pax > DAY_PASS_DAILY_CAPACITY) finalDate = null;
        }
        if (!finalDate) {
          logger.warn(
            { orderId: order.id, requested },
            "Day-pass requested date unavailable at payment; booking created undated",
          );
        }
      }

      await tx
        .insert(dayPassBookings)
        .values({
          orderId: order.id,
          email,
          productId: order.productId ?? "day_pass",
          productName: order.productName,
          pax,
          visitDate: finalDate,
          status: "booked",
        })
        .onConflictDoNothing({ target: dayPassBookings.orderId });
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to create day-pass booking");
  }
}

async function ownedBooking(
  bookingId: string,
  email: string | null,
): Promise<DayPassBooking | null> {
  const [b] = await db
    .select()
    .from(dayPassBookings)
    .where(eq(dayPassBookings.id, bookingId));
  if (!b) return null;
  if (email !== null && b.email !== email.trim().toLowerCase()) return null;
  return b;
}

export type BookingActionError =
  | { error: "not_found" }
  | { error: "not_active" }
  | { error: "already_dated" }
  | { error: "not_dated" }
  | { error: "too_late" }
  | { error: "no_reschedules" }
  | { error: ReserveReason };

/**
 * Assign a visit date to an undated booking (owner-scoped). Atomic capacity
 * reservation. Does not count against the reschedule allowance.
 */
export async function assignBookingDate(
  email: string,
  bookingId: string,
  dateStr: string,
): Promise<{ ok: true; booking: DayPassBooking } | BookingActionError> {
  const b = await ownedBooking(bookingId, email);
  if (!b) return { error: "not_found" };
  if (b.status !== "booked") return { error: "not_active" };
  if (b.visitDate) return { error: "already_dated" };

  return reserveInto(b, dateStr, { incrementReschedule: false });
}

/**
 * Move a dated booking to a new date. Customer path (`staff` false) enforces the
 * 48h-before and max-2-reschedules rules and consumes one reschedule. Staff may
 * override both, and an override does not consume the customer's allowance.
 */
export async function rescheduleBooking(
  email: string | null,
  bookingId: string,
  dateStr: string,
  { staff = false }: { staff?: boolean } = {},
): Promise<{ ok: true; booking: DayPassBooking } | BookingActionError> {
  const b = await ownedBooking(bookingId, email);
  if (!b) return { error: "not_found" };
  if (b.status !== "booked") return { error: "not_active" };
  if (!b.visitDate) return { error: "not_dated" };

  if (!staff) {
    if (b.rescheduleCount >= MAX_RESCHEDULES) return { error: "no_reschedules" };
    if (hoursUntilVisit(b.visitDate) < RESCHEDULE_MIN_HOURS) {
      return { error: "too_late" };
    }
  }

  return reserveInto(b, dateStr, { incrementReschedule: !staff });
}

/** Shared atomic "move this booking onto `dateStr`" used by assign + reschedule. */
async function reserveInto(
  b: DayPassBooking,
  dateStr: string,
  { incrementReschedule }: { incrementReschedule: boolean },
): Promise<{ ok: true; booking: DayPassBooking } | BookingActionError> {
  try {
    const result = await db.transaction(async (tx) => {
      const reason = await dateClosedReason(tx, dateStr);
      if (reason) return { error: reason } as BookingActionError;
      const used = await lockAndCountDate(tx, dateStr, b.id);
      if (used + b.pax > DAY_PASS_DAILY_CAPACITY) {
        return { error: "full" } as BookingActionError;
      }
      const [updated] = await tx
        .update(dayPassBookings)
        .set({
          visitDate: dateStr,
          // New date ⇒ re-arm the pre-visit reminder for the new visit day.
          reminderEmailedAt: null,
          rescheduleCount: incrementReschedule
            ? b.rescheduleCount + 1
            : b.rescheduleCount,
          updatedAt: new Date(),
        })
        .where(
          and(eq(dayPassBookings.id, b.id), eq(dayPassBookings.status, "booked")),
        )
        .returning();
      if (!updated) return { error: "not_active" } as BookingActionError;
      return { ok: true as const, booking: updated };
    });
    return result;
  } catch (err) {
    logger.error({ err, bookingId: b.id }, "Failed to reserve day-pass date");
    return { error: "full" };
  }
}

const STOPPABLE_INSTALMENT_STATUSES = [
  "scheduled",
  "failed",
  "needs_action",
] as const;

/** Cash collected so far on an order (excludes the credit portion). */
function collectedCashMinor(
  order: StoreOrder,
  instalments: { number: number; amountMinor: number; status: string }[],
): number {
  const cashDue = Number(order.totalMinor) - Number(order.creditAppliedMinor);
  const laterTotal = instalments.reduce((s, i) => s + Number(i.amountMinor), 0);
  const slot1 = cashDue - laterTotal;
  let collected = 0;
  if (order.paidInstalments >= 1) collected += slot1;
  collected += instalments
    .filter((i) => i.status === "paid")
    .reduce((s, i) => s + Number(i.amountMinor), 0);
  return Math.max(0, collected);
}

export interface CancelOutcome {
  ok: true;
  penalty: boolean;
  penalty_kept_minor: number;
  credit_minor: number;
  currency: string;
  booking: DayPassBooking;
}

/**
 * Cancel a booking. No cash refund: the value paid in (collected cash + any
 * credit applied) converts to account credit. A 25% penalty is kept when the
 * cancellation is within 24h of the visit OR the 2 free reschedules are already
 * used; otherwise the full value becomes credit. The underlying order is
 * cancelled (future instalments stopped) and any issued voucher is voided so the
 * guest cannot hold both a voucher and the credit.
 */
export async function cancelBooking(
  email: string | null,
  bookingId: string,
  { staff = false }: { staff?: boolean } = {},
): Promise<CancelOutcome | BookingActionError> {
  const b = await ownedBooking(bookingId, email);
  if (!b) return { error: "not_found" };
  if (b.status !== "booked") return { error: "not_active" };

  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, b.orderId));
  if (!order) return { error: "not_found" };

  const insts = await db
    .select({
      number: storeInstallments.number,
      amountMinor: storeInstallments.amountMinor,
      status: storeInstallments.status,
    })
    .from(storeInstallments)
    .where(eq(storeInstallments.orderId, order.id));

  const valueIn =
    collectedCashMinor(order, insts) + Number(order.creditAppliedMinor);
  const penalty =
    !staff &&
    ((b.visitDate != null &&
      hoursUntilVisit(b.visitDate) < CANCEL_PENALTY_HOURS) ||
      b.rescheduleCount >= MAX_RESCHEDULES);
  const creditMinor = penalty
    ? Math.round(valueIn * (1 - CANCEL_PENALTY_KEPT))
    : valueIn;
  const penaltyKept = valueIn - creditMinor;

  try {
    const result = await db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(dayPassBookings)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(dayPassBookings.id, b.id), eq(dayPassBookings.status, "booked")),
        )
        .returning();
      if (!cancelled) return { error: "not_active" } as BookingActionError;

      // Stop any remaining chargeable instalments and mark the order cancelled.
      await tx
        .update(storeInstallments)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(storeInstallments.orderId, order.id),
            inArray(storeInstallments.status, [...STOPPABLE_INSTALMENT_STATUSES]),
          ),
        );
      await tx
        .update(storeOrders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(storeOrders.id, order.id));

      // Void any issued voucher so value isn't held twice.
      await tx
        .update(storeVouchers)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(storeVouchers.orderId, order.id),
            inArray(storeVouchers.status, ["active", "pending"]),
          ),
        );

      if (creditMinor > 0) {
        await postCreditTx(tx, {
          email: order.buyerEmail.trim().toLowerCase(),
          currency: order.currency,
          amountMinor: creditMinor,
          reason: penalty ? "cancellation_penalty" : "cancellation",
          orderId: order.id,
          bookingId: b.id,
        });
      }

      return {
        ok: true as const,
        penalty,
        penalty_kept_minor: penaltyKept,
        credit_minor: creditMinor,
        currency: order.currency,
        booking: cancelled,
      };
    });
    return result;
  } catch (err) {
    logger.error({ err, bookingId: b.id }, "Failed to cancel day-pass booking");
    return { error: "not_active" };
  }
}

// ── Account credit ledger ──────────────────────────────────────────────────

interface CreditMovement {
  email: string;
  currency: string;
  amountMinor: number;
  reason: string;
  orderId?: string | null;
  bookingId?: string | null;
}

async function postCreditTx(tx: Tx, m: CreditMovement): Promise<void> {
  const email = m.email.trim().toLowerCase();
  const currency = m.currency.toLowerCase();
  await tx
    .insert(accountCreditBalances)
    .values({ email, currency, balanceMinor: m.amountMinor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [accountCreditBalances.email, accountCreditBalances.currency],
      set: {
        balanceMinor: sql`${accountCreditBalances.balanceMinor} + ${m.amountMinor}`,
        updatedAt: new Date(),
      },
    });
  await tx.insert(accountCreditEntries).values({
    email,
    currency,
    amountMinor: m.amountMinor,
    reason: m.reason,
    orderId: m.orderId ?? null,
    bookingId: m.bookingId ?? null,
  });
}

/** Add credit to an account (e.g. on cancellation or as a restore). */
export async function postCredit(m: CreditMovement): Promise<void> {
  await db.transaction((tx) => postCreditTx(tx, m));
}

/**
 * Spend credit atomically. The conditional decrement only matches when the
 * balance is sufficient, so concurrent spends can never overdraw. Returns false
 * when there isn't enough credit (nothing is changed).
 */
export async function spendCredit(m: CreditMovement): Promise<boolean> {
  const email = m.email.trim().toLowerCase();
  const currency = m.currency.toLowerCase();
  const updated = await db
    .update(accountCreditBalances)
    .set({
      balanceMinor: sql`${accountCreditBalances.balanceMinor} - ${m.amountMinor}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(accountCreditBalances.email, email),
        eq(accountCreditBalances.currency, currency),
        gte(accountCreditBalances.balanceMinor, m.amountMinor),
      ),
    )
    .returning({ id: accountCreditBalances.email });
  if (updated.length === 0) return false;
  await db.insert(accountCreditEntries).values({
    email,
    currency,
    amountMinor: -m.amountMinor,
    reason: m.reason,
    orderId: m.orderId ?? null,
    bookingId: m.bookingId ?? null,
  });
  return true;
}

/** Restore credit reserved for an order that never completed (best-effort). */
export async function restoreReservedCredit(order: {
  id: string;
  buyerEmail: string;
  currency: string;
  creditAppliedMinor: number;
}): Promise<void> {
  if (Number(order.creditAppliedMinor) <= 0) return;
  try {
    await postCredit({
      email: order.buyerEmail,
      currency: order.currency,
      amountMinor: Number(order.creditAppliedMinor),
      reason: "checkout_reversal",
      orderId: order.id,
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to restore reserved credit");
  }
}

export interface CreditBalance {
  currency: string;
  balance_minor: number;
}

export async function getCreditBalances(email: string): Promise<CreditBalance[]> {
  const rows = await db
    .select()
    .from(accountCreditBalances)
    .where(eq(accountCreditBalances.email, email.trim().toLowerCase()));
  return rows
    .filter((r) => Number(r.balanceMinor) > 0)
    .map((r) => ({ currency: r.currency, balance_minor: Number(r.balanceMinor) }));
}

export async function getCreditBalance(
  email: string,
  currency: string,
): Promise<number> {
  const [row] = await db
    .select()
    .from(accountCreditBalances)
    .where(
      and(
        eq(accountCreditBalances.email, email.trim().toLowerCase()),
        eq(accountCreditBalances.currency, currency.toLowerCase()),
      ),
    );
  return Math.max(0, Number(row?.balanceMinor ?? 0));
}

// ── Dashboard view helpers ─────────────────────────────────────────────────

export interface DashboardBooking {
  id: string;
  order_id: string;
  product_name: string;
  visit_date: string | null;
  status: string;
  pax: number;
  reschedule_count: number;
  reschedules_remaining: number;
  needs_date: boolean;
  can_reschedule: boolean;
  can_cancel: boolean;
  penalty_on_cancel: boolean;
  voucher_code: string | null;
  currency: string;
}

/** Customer-facing action availability for a booking. */
export function bookingActions(b: DayPassBooking) {
  const active = b.status === "booked";
  const dated = !!b.visitDate;
  const reschedulesRemaining = Math.max(0, MAX_RESCHEDULES - b.rescheduleCount);
  const hrs = dated ? hoursUntilVisit(b.visitDate as string) : null;
  return {
    reschedules_remaining: reschedulesRemaining,
    needs_date: active && !dated,
    can_reschedule:
      active && dated && reschedulesRemaining > 0 && hrs! >= RESCHEDULE_MIN_HOURS,
    can_cancel: active,
    penalty_on_cancel:
      active &&
      ((dated && hrs! < CANCEL_PENALTY_HOURS) ||
        b.rescheduleCount >= MAX_RESCHEDULES),
  };
}

export const DEFAULT_STORE_CURRENCY = SETTINGS.currency;

// ── Admin: blocked dates & calendar ─────────────────────────────────────────

export interface BlockedDateRow {
  date: string;
  reason: string | null;
}

export async function listBlockedDates(): Promise<BlockedDateRow[]> {
  const rows = await db
    .select()
    .from(dayPassBlockedDates)
    .orderBy(dayPassBlockedDates.date);
  return rows.map((r) => ({ date: r.date, reason: r.reason }));
}

export async function blockDate(
  dateStr: string,
  reason: string | null,
): Promise<BlockedDateRow | null> {
  if (!isValidDateStr(dateStr)) return null;
  const [row] = await db
    .insert(dayPassBlockedDates)
    .values({ date: dateStr, reason: reason ?? null })
    .onConflictDoUpdate({
      target: dayPassBlockedDates.date,
      set: { reason: reason ?? null },
    })
    .returning();
  return { date: row.date, reason: row.reason };
}

export async function unblockDate(dateStr: string): Promise<boolean> {
  if (!isValidDateStr(dateStr)) return false;
  await db
    .delete(dayPassBlockedDates)
    .where(eq(dayPassBlockedDates.date, dateStr));
  return true;
}

export interface AdminBookingRow {
  id: string;
  order_id: string;
  email: string;
  product_name: string;
  visit_date: string | null;
  status: string;
  pax: number;
  reschedule_count: number;
}

export interface AdminCalendarDay extends DayAvailability {
  bookings: AdminBookingRow[];
}

/** Calendar with per-day booking lists for the admin view. */
export async function getAdminCalendar(
  from: string,
  to: string,
): Promise<AdminCalendarDay[]> {
  const days = await getAvailability(from, to, 1);
  if (days.length === 0) return [];

  const rows = await db
    .select()
    .from(dayPassBookings)
    .where(
      and(
        eq(dayPassBookings.status, "booked"),
        isNotNull(dayPassBookings.visitDate),
        gte(dayPassBookings.visitDate, from),
        lte(dayPassBookings.visitDate, to),
      ),
    );
  const byDate = new Map<string, AdminBookingRow[]>();
  for (const r of rows) {
    if (!r.visitDate) continue;
    const list = byDate.get(r.visitDate) ?? [];
    list.push({
      id: r.id,
      order_id: r.orderId,
      email: r.email,
      product_name: r.productName,
      visit_date: r.visitDate,
      status: r.status,
      pax: r.pax,
      reschedule_count: r.rescheduleCount,
    });
    byDate.set(r.visitDate, list);
  }

  return days.map((d) => ({ ...d, bookings: byDate.get(d.date) ?? [] }));
}

// ── Pre-visit reminder sweep ────────────────────────────────────────────────

/**
 * Email a reminder to every booked, dated guest whose visit is tomorrow (resort
 * timezone) and who has not yet been reminded for their current date. Undated /
 * gift bookings are excluded (no `visitDate`); a reschedule clears the claim so
 * the new date re-arms a fresh reminder.
 *
 * Each send is guarded by a conditional claim on `reminderEmailedAt`, so the
 * recurring sweep (and concurrent processes) deliver at most one reminder per
 * booking per date. A failed delivery releases the claim so a later tick retries.
 * Returns the number of reminders actually delivered.
 */
export async function sendDueVisitReminders(): Promise<number> {
  const target = addDays(resortToday(), 1);

  const due = await db
    .select()
    .from(dayPassBookings)
    .where(
      and(
        eq(dayPassBookings.status, "booked"),
        eq(dayPassBookings.visitDate, target),
        isNull(dayPassBookings.reminderEmailedAt),
      ),
    );
  if (due.length === 0) return 0;

  let sent = 0;
  for (const b of due) {
    // Claim the one-time send slot; the loser of any race sends nothing.
    const [claimed] = await db
      .update(dayPassBookings)
      .set({ reminderEmailedAt: new Date() })
      .where(
        and(
          eq(dayPassBookings.id, b.id),
          isNull(dayPassBookings.reminderEmailedAt),
        ),
      )
      .returning({ id: dayPassBookings.id });
    if (!claimed) continue;

    const [voucher] = await db
      .select({ code: storeVouchers.code, status: storeVouchers.status })
      .from(storeVouchers)
      .where(eq(storeVouchers.orderId, b.orderId));
    const voucherCode =
      voucher && voucher.status === "active" ? voucher.code : null;

    const delivered = await sendVisitReminderEmail({
      to: b.email,
      productName: b.productName,
      visitDate: b.visitDate as string,
      pax: b.pax,
      voucherCode,
    });
    if (delivered) {
      sent++;
    } else {
      // Release the claim so a later sweep can re-attempt the reminder.
      await db
        .update(dayPassBookings)
        .set({ reminderEmailedAt: null })
        .where(eq(dayPassBookings.id, b.id));
    }
  }
  return sent;
}
