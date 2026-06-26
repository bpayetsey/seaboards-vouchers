import crypto from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  storeOrders,
  storeInstallments,
  storeVouchers,
  groupOrders,
  voucherLines,
  type StoreOrder,
  type StoreInstallment,
  type StoreVoucher,
} from "@workspace/db";
import {
  getUncachableStripeClient,
  fetchReceiptUrlForSession,
} from "./stripeClient";
import { processPaidIntent } from "./storefront";
import { sendActionRequiredEmail, sendPaymentFailedEmail } from "./storeEmail";
import { logger } from "./logger";

const newCode = (): string =>
  "SB50-" +
  Array.from({ length: 3 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase(),
  ).join("-");

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Instalment states that still expect a charge (and are eligible for retry). */
const RETRYABLE = ["failed", "needs_action"] as const;
/** Instalment states that should be stopped when an order is cancelled. */
const STOPPABLE = ["scheduled", "failed", "needs_action", "charging"] as const;

interface CurrencyAmount {
  currency: string;
  amount_minor: number;
}
interface CurrencyCount {
  currency: string;
  count: number;
  amount_minor: number;
}

/** The minor amount collected for an order's first payment, when paid. */
function firstAmountMinor(order: StoreOrder): number {
  const total = Number(order.totalMinor);
  return order.installments <= 1
    ? total
    : Math.round(total / order.installments);
}

function bump(
  map: Map<string, { count: number; amount: number }>,
  currency: string,
  amount: number,
): void {
  const entry = map.get(currency) ?? { count: 0, amount: 0 };
  entry.count += 1;
  entry.amount += amount;
  map.set(currency, entry);
}

/**
 * Aggregates collected revenue by currency, voucher counts by status, and
 * outstanding/failed instalment totals into a single overview. Scoped to the
 * direct storefront flow (store_order / store_installment / store_voucher).
 */
export async function getAdminOverview(): Promise<{
  revenue: CurrencyAmount[];
  vouchers_issued: number;
  vouchers_active: number;
  vouchers_redeemed: number;
  outstanding_count: number;
  outstanding: CurrencyCount[];
  failed_count: number;
  failed: CurrencyCount[];
}> {
  const orders = await db.select().from(storeOrders);
  const instalments = await db.select().from(storeInstallments);
  const vouchers = await db.select().from(storeVouchers);

  // Revenue: paid first payments + paid subsequent instalments, by currency.
  const revenue = new Map<string, number>();
  const addRevenue = (currency: string, amount: number) =>
    revenue.set(currency, (revenue.get(currency) ?? 0) + amount);
  for (const order of orders) {
    if (order.paidInstalments >= 1) {
      addRevenue(order.currency, firstAmountMinor(order));
    }
  }
  for (const inst of instalments) {
    if (inst.status === "paid") {
      const order = orders.find((o) => o.id === inst.orderId);
      if (order) addRevenue(order.currency, Number(inst.amountMinor));
    }
  }

  // Voucher counts.
  const now = Date.now();
  let active = 0;
  let redeemed = 0;
  for (const v of vouchers) {
    if (v.status === "redeemed" || v.redeemedAt) {
      redeemed += 1;
    } else if (
      v.status === "active" &&
      (!v.expiresAt || new Date(v.expiresAt).getTime() > now)
    ) {
      active += 1;
    }
  }

  // Outstanding (scheduled) and failed/needs-action instalment totals.
  const outstanding = new Map<string, { count: number; amount: number }>();
  const failed = new Map<string, { count: number; amount: number }>();
  for (const inst of instalments) {
    const order = orders.find((o) => o.id === inst.orderId);
    if (!order) continue;
    if (inst.status === "scheduled") {
      bump(outstanding, order.currency, Number(inst.amountMinor));
    } else if (inst.status === "failed" || inst.status === "needs_action") {
      bump(failed, order.currency, Number(inst.amountMinor));
    }
  }

  const toCounts = (m: Map<string, { count: number; amount: number }>) =>
    Array.from(m.entries()).map(([currency, v]) => ({
      currency,
      count: v.count,
      amount_minor: v.amount,
    }));
  const totalCount = (rows: CurrencyCount[]) =>
    rows.reduce((sum, r) => sum + r.count, 0);

  const outstandingRows = toCounts(outstanding);
  const failedRows = toCounts(failed);

  return {
    revenue: Array.from(revenue.entries()).map(([currency, amount_minor]) => ({
      currency,
      amount_minor,
    })),
    vouchers_issued: vouchers.length,
    vouchers_active: active,
    vouchers_redeemed: redeemed,
    outstanding_count: totalCount(outstandingRows),
    outstanding: outstandingRows,
    failed_count: totalCount(failedRows),
    failed: failedRows,
  };
}

function instalmentSummary(
  currency: string,
  i: {
    id: string;
    number: number;
    amountMinor: number | string;
    dueAt: Date;
    status: string;
    attempts: number;
    lastError: string | null;
  },
) {
  return {
    id: i.id,
    number: i.number,
    amount_minor: Number(i.amountMinor),
    currency,
    due_at: new Date(i.dueAt).toISOString(),
    status: i.status,
    attempts: i.attempts,
    last_error: i.lastError ?? null,
  };
}

/** All storefront orders with their first payment + full instalment schedule. */
export async function getAdminOrdersDetailed() {
  const orders = await db
    .select()
    .from(storeOrders)
    .orderBy(desc(storeOrders.createdAt))
    .limit(200);

  const result = [];
  for (const order of orders) {
    const schedule = await db
      .select()
      .from(storeInstallments)
      .where(eq(storeInstallments.orderId, order.id))
      .orderBy(asc(storeInstallments.number));
    const [voucher] = await db
      .select()
      .from(storeVouchers)
      .where(eq(storeVouchers.orderId, order.id));

    const firstPaid = order.paidInstalments >= 1;
    const firstStatus =
      order.status === "cancelled"
        ? firstPaid
          ? "paid"
          : "cancelled"
        : firstPaid
          ? "paid"
          : order.status === "expired"
            ? "expired"
            : "pending";

    result.push({
      id: order.id,
      product_name: order.productName,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      currency: order.currency,
      total_minor: Number(order.totalMinor),
      installments: order.installments,
      paid_instalments: order.paidInstalments,
      status: order.status,
      created_at: order.createdAt.toISOString(),
      first_payment: {
        id: `${order.id}:first`,
        number: 1,
        amount_minor: firstAmountMinor(order),
        currency: order.currency,
        due_at: order.createdAt.toISOString(),
        status: firstStatus,
        attempts: 0,
        last_error: null,
      },
      instalments: schedule.map((s) => instalmentSummary(order.currency, s)),
      voucher: voucher
        ? { code: voucher.code, status: voucher.status }
        : null,
    });
  }
  return { orders: result };
}

/**
 * All group-ordering orders (independent, flat and split) with each share's
 * status and receipt, paid-vs-total progress, and — for split orders — whether
 * the combined master voucher has been released. The master voucher is only
 * minted once every share is paid, so a partially-paid split order always
 * reports `voucher_released: false` and a null `split_voucher_code`.
 *
 * Paid shares missing a stored receipt URL (older rows, or a webhook that raced
 * the Stripe API) get a best-effort on-demand lookup, persisted for next time.
 */
export async function getAdminGroupOrders() {
  const orders = await db
    .select()
    .from(groupOrders)
    .orderBy(desc(groupOrders.createdAt))
    .limit(200);

  const result = [];
  for (const order of orders) {
    const lines = await db
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.groupOrderId, order.id))
      .orderBy(asc(voucherLines.createdAt));

    let paidCount = 0;
    let paidMinor = 0;
    let totalMinor = 0;
    const participants = [];
    for (const line of lines) {
      const amount = Number(line.amountMinor);
      totalMinor += amount;
      const paid = line.status === "paid" || line.paidAt != null;
      if (paid) {
        paidCount += 1;
        paidMinor += amount;
      }

      // Backfill a missing receipt for a paid share (best-effort, never throws).
      let receipt = line.receiptUrl;
      if (paid && !receipt && line.stripeSessionId) {
        try {
          const stripe = await getUncachableStripeClient();
          receipt = await fetchReceiptUrlForSession(
            stripe,
            line.stripeSessionId,
          );
        } catch {
          receipt = null;
        }
        if (receipt) {
          await db
            .update(voucherLines)
            .set({ receiptUrl: receipt })
            .where(eq(voucherLines.id, line.id));
        }
      }

      participants.push({
        id: line.id,
        payer_name: line.payerName,
        payer_email: line.payerEmail,
        amount_minor: amount,
        status: paid ? "paid" : line.status,
        paid_at: paid ? iso(line.paidAt) : null,
        receipt_url: paid ? (receipt ?? null) : null,
        voucher_code: line.voucherCode,
        credit_code: line.creditCode,
      });
    }

    const voucherReleased =
      order.mode === "split" &&
      order.status === "complete" &&
      !!order.splitVoucherCode;

    result.push({
      id: order.id,
      mode: order.mode,
      status: order.status,
      organiser_name: order.organiserName,
      organiser_email: order.organiserEmail,
      currency: order.currency,
      created_at: order.createdAt.toISOString(),
      due_by: iso(order.dueBy),
      split_apartment_type: order.splitApartmentType,
      split_nights: order.splitNights,
      // Only expose the master code once it has actually been released.
      split_voucher_code: voucherReleased ? order.splitVoucherCode : null,
      voucher_released: voucherReleased,
      paid_count: paidCount,
      total_count: lines.length,
      paid_minor: paidMinor,
      total_minor: totalMinor,
      participants,
    });
  }
  return { orders: result };
}

type RetryResult = { status: string; message: string | null };

/**
 * Stripe error types where Stripe definitively did NOT take the money, so it is
 * safe to advance the attempt counter and issue a brand-new charge next time.
 * Anything else (connection drop, timeout, generic API error) is treated as
 * INDETERMINATE: we must not advance the key, so a follow-up retry replays the
 * SAME idempotency key and Stripe reconciles it instead of double-charging.
 */
const DEFINITIVE_NO_CHARGE_ERROR_TYPES = new Set([
  "StripeCardError",
  "StripeInvalidRequestError",
]);

/** Stripe PaymentIntent statuses that mean a charge is already in flight. */
const IN_FLIGHT_PI_STATUSES = new Set([
  "succeeded",
  "processing",
  "requires_capture",
]);

/**
 * Retry a specific failed/needs-action instalment by charging the saved card
 * off-session immediately. The row is atomically claimed (status -> charging)
 * so a concurrent retry or the daily job cannot double-charge.
 *
 * Idempotency / no-double-charge guarantees:
 * - The idempotency key is `...-retry{attempts}`. `attempts` is only advanced
 *   when Stripe proves no charge happened (card decline, auth required, invalid
 *   request). On an indeterminate failure (timeout / connection / API error)
 *   the counter is left untouched, so the next retry reuses the SAME key and
 *   Stripe returns the original PaymentIntent rather than creating a second one.
 * - Before charging we reconcile any PaymentIntent already recorded on the row:
 *   if it is already succeeded/processing we never issue a new charge.
 */
export async function retryInstalment(
  orderId: string,
  instalmentId: string,
): Promise<RetryResult | { error: "not_found" | "not_retryable" }> {
  const [inst] = await db
    .select()
    .from(storeInstallments)
    .where(
      and(
        eq(storeInstallments.id, instalmentId),
        eq(storeInstallments.orderId, orderId),
      ),
    );
  if (!inst) return { error: "not_found" };

  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, orderId));
  if (!order) return { error: "not_found" };
  if (order.status === "cancelled") return { error: "not_retryable" };
  if (!order.stripePaymentMethodId) return { error: "not_retryable" };
  if (!RETRYABLE.includes(inst.status as (typeof RETRYABLE)[number])) {
    return { error: "not_retryable" };
  }

  const claimed = await db
    .update(storeInstallments)
    .set({ status: "charging" })
    .where(
      and(
        eq(storeInstallments.id, inst.id),
        inArray(storeInstallments.status, [...RETRYABLE]),
      ),
    )
    .returning({ id: storeInstallments.id });
  if (claimed.length === 0) return { error: "not_retryable" };

  try {
    const stripe = await getUncachableStripeClient();

    // Reconcile any charge from a previous (possibly indeterminate) attempt
    // before starting a new one, so we never stack a second charge on top of an
    // in-flight or already-successful PaymentIntent.
    if (inst.paymentIntentId) {
      const existing = await stripe.paymentIntents.retrieve(inst.paymentIntentId);
      if (existing.status === "succeeded") {
        await processPaidIntent(existing);
        return { status: "paid", message: null };
      }
      if (IN_FLIGHT_PI_STATUSES.has(existing.status)) {
        return {
          status: "processing",
          message: "A charge is already in progress; awaiting confirmation.",
        };
      }
    }

    const pi = await stripe.paymentIntents.create(
      {
        amount: Number(inst.amountMinor),
        currency: order.currency,
        customer: order.stripeCustomerId,
        payment_method: order.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: { orderId: order.id, instalmentNo: String(inst.number) },
      },
      {
        idempotencyKey: `store-order-${order.id}-i${inst.number}-retry${inst.attempts}`,
      },
    );

    await db
      .update(storeInstallments)
      .set({ paymentIntentId: pi.id })
      .where(eq(storeInstallments.id, inst.id));

    if (pi.status === "succeeded") {
      // Finalise immediately for instant feedback; processPaidIntent is
      // idempotent so the webhook re-processing is harmless.
      await processPaidIntent(pi);
      return { status: "paid", message: null };
    }
    return {
      status: "processing",
      message: "Charge submitted; awaiting confirmation.",
    };
  } catch (err) {
    const type = (err as { type?: string }).type;
    const code = (err as { code?: string }).code;

    // Auth-required is a definitive decline (no money moved) — advance the key.
    if (code === "authentication_required") {
      await db
        .update(storeInstallments)
        .set({ status: "needs_action", attempts: inst.attempts + 1 })
        .where(eq(storeInstallments.id, inst.id));
      await sendActionRequiredEmail(order, inst);
      return {
        status: "needs_action",
        message: "The card needs customer authentication.",
      };
    }

    const message = err instanceof Error ? err.message : "charge failed";
    const definitiveNoCharge =
      typeof type === "string" && DEFINITIVE_NO_CHARGE_ERROR_TYPES.has(type);

    // Only advance the idempotency key when Stripe proves no charge happened.
    // For indeterminate failures we keep `attempts` (and therefore the key)
    // unchanged so a follow-up retry reconciles via the same key rather than
    // creating a second charge. The payment_intent.succeeded webhook is the
    // backstop that finalises any charge that actually went through.
    await db
      .update(storeInstallments)
      .set({
        status: "failed",
        lastError: message,
        ...(definitiveNoCharge ? { attempts: inst.attempts + 1 } : {}),
      })
      .where(eq(storeInstallments.id, inst.id));

    if (definitiveNoCharge) {
      await sendPaymentFailedEmail(order, inst);
    }
    logger.warn(
      { err, instalmentId: inst.id, definitiveNoCharge },
      "Manual instalment retry failed",
    );
    return {
      status: "failed",
      message: definitiveNoCharge
        ? message
        : "The charge could not be confirmed. Please retry — it will not be charged twice.",
    };
  }
}

/**
 * Cancel an order: mark it cancelled and stop every remaining chargeable
 * instalment so the daily job (which only charges scheduled/failed rows) never
 * attempts another charge. No refunds are issued.
 */
export async function cancelOrder(
  orderId: string,
): Promise<{ status: string; cancelled_instalments: number } | { error: "not_found" }> {
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, orderId));
  if (!order) return { error: "not_found" };

  const cancelled = await db
    .update(storeInstallments)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(storeInstallments.orderId, orderId),
        inArray(storeInstallments.status, [...STOPPABLE]),
      ),
    )
    .returning({ id: storeInstallments.id });

  await db
    .update(storeOrders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(storeOrders.id, orderId));

  return { status: "cancelled", cancelled_instalments: cancelled.length };
}

function voucherDto(v: StoreVoucher) {
  return {
    id: v.id,
    code: v.code,
    value_minor: Number(v.valueMinor),
    currency: v.currency,
    status: v.status,
    expires_at: iso(v.expiresAt),
    redeemed_at: iso(v.redeemedAt),
    created_at: v.createdAt.toISOString(),
    order_id: v.orderId ?? null,
  };
}

/** Manually issue a new active voucher (no originating order). */
export async function issueVoucher(input: {
  value_minor: number;
  currency: string;
  expires_at: string;
}) {
  const expiresAt = new Date(input.expires_at);
  const [voucher] = await db
    .insert(storeVouchers)
    .values({
      orderId: null,
      code: newCode(),
      valueMinor: input.value_minor,
      currency: input.currency.toLowerCase(),
      status: "active",
      expiresAt,
    })
    .returning();
  return voucherDto(voucher);
}

/** Compute a redemption verdict for a voucher row. */
function verdict(v: StoreVoucher): { valid: boolean; reason: string | null } {
  if (v.status === "redeemed" || v.redeemedAt) {
    return { valid: false, reason: "already_redeemed" };
  }
  if (v.expiresAt && new Date(v.expiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: "expired" };
  }
  if (v.status !== "active") {
    return { valid: false, reason: "not_active" };
  }
  return { valid: true, reason: null };
}

type LookupResult = {
  found: boolean;
  valid: boolean;
  reason: string | null;
  voucher: ReturnType<typeof voucherDto> | null;
};

export async function lookupVoucher(code: string): Promise<LookupResult> {
  const [v] = await db
    .select()
    .from(storeVouchers)
    .where(eq(storeVouchers.code, code.trim()));
  if (!v) {
    return { found: false, valid: false, reason: "not_found", voucher: null };
  }
  const { valid, reason } = verdict(v);
  return { found: true, valid, reason, voucher: voucherDto(v) };
}

/**
 * Redeem a voucher in one atomic step. The UPDATE only matches a voucher that
 * is currently active, unexpired and not yet redeemed, so two concurrent
 * redeem calls can never both succeed (guards against double-redeem).
 */
export async function redeemVoucher(
  code: string,
): Promise<LookupResult & { redeemed: boolean }> {
  const trimmed = code.trim();
  const now = new Date();

  const updated = await db
    .update(storeVouchers)
    .set({ status: "redeemed", redeemedAt: now })
    .where(
      and(
        eq(storeVouchers.code, trimmed),
        eq(storeVouchers.status, "active"),
      ),
    )
    .returning();

  if (updated.length > 0) {
    const v = updated[0];
    // Re-check expiry: an expired-but-active voucher should not be redeemable.
    // (status flips to redeemed above; if it was expired we revert and report.)
    if (v.expiresAt && new Date(v.expiresAt).getTime() <= now.getTime()) {
      await db
        .update(storeVouchers)
        .set({ status: "active", redeemedAt: null })
        .where(eq(storeVouchers.id, v.id));
      return {
        found: true,
        valid: false,
        reason: "expired",
        voucher: voucherDto({ ...v, status: "active", redeemedAt: null }),
        redeemed: false,
      };
    }
    return {
      found: true,
      valid: true,
      reason: null,
      voucher: voucherDto(v),
      redeemed: true,
    };
  }

  // Nothing redeemed — report why via a fresh lookup.
  const result = await lookupVoucher(trimmed);
  return { ...result, redeemed: false };
}

export type { StoreInstallment };
