import crypto from "node:crypto";
import { and, asc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { db, groupOrders, voucherLines, newOrderNumber } from "@workspace/db";
import type Stripe from "stripe";
import {
  getUncachableStripeClient,
  fetchReceiptUrlForPaymentIntent,
} from "./stripeClient";
import { getEffectiveCatalog } from "./storeCatalog";
import { sendIssuedVoucherEmail } from "./voucherEmail";
import { logger } from "./logger";

// Default per-night rates; kept as a fallback when the catalog can't be read.
export const RATES: Record<string, number> = {
  one_bedroom: 2300,
  two_bedroom: 3750,
};
// Group split uses underscore apartment_type keys; the storefront catalog uses
// hyphenated ids. This maps catalog ids onto the apartment_type keys so prices
// edited in the admin flow through to group pricing too.
const CATALOG_ID_TO_APARTMENT_TYPE: Record<string, string> = {
  "one-bedroom": "one_bedroom",
  "two-bedroom": "two_bedroom",
};
export const CURRENCY = process.env.VOUCHER_CURRENCY || "SCR";
export const MINOR_PER_MAJOR = 100;

/** Effective per-night rates with any admin price overrides applied. */
export async function getRates(): Promise<Record<string, number>> {
  try {
    const catalog = await getEffectiveCatalog();
    const rates: Record<string, number> = { ...RATES };
    for (const item of catalog) {
      const key = CATALOG_ID_TO_APARTMENT_TYPE[item.id];
      if (key) rates[key] = item.rate;
    }
    return rates;
  } catch {
    return { ...RATES };
  }
}

const token = (n = 18): string => crypto.randomBytes(n).toString("base64url");
const voucherCode = (): string =>
  "SEA-JUB-" + crypto.randomBytes(4).toString("hex").toUpperCase();
const creditCode = (): string =>
  "EZZY-CR-" + crypto.randomBytes(4).toString("hex").toUpperCase();

export function lineAmountMinor(
  apartmentType: string | null | undefined,
  nights: number | null | undefined,
  rates: Record<string, number> = RATES,
): number {
  const rate = apartmentType ? rates[apartmentType] : undefined;
  if (!rate) throw new Error(`Unknown apartment_type: ${apartmentType}`);
  const n = Number(nights);
  if (!Number.isInteger(n) || n < 1)
    throw new Error("nights must be a positive integer");
  return rate * n * MINOR_PER_MAJOR;
}

interface LineInput {
  payer_name?: string | null;
  payer_email: string;
  apartment_type?: string | null;
  nights?: number | null;
  share_minor?: number | null;
}

interface CreateGroupOrderInput {
  mode: "independent" | "split" | "flat";
  organiser_name?: string | null;
  organiser_email: string;
  due_by?: string | null;
  per_person_minor?: number | null;
  split?: {
    apartment_type?: string | null;
    nights?: number | null;
    amount_minor?: number | null;
  } | null;
  lines: LineInput[];
}

interface PreparedLine {
  apartmentType: string | null;
  nights: number | null;
  amountMinor: number;
  payerName: string;
  payerEmail: string;
}

export async function createGroupOrder(input: CreateGroupOrderInput) {
  const { mode, organiser_name, organiser_email, lines, split, due_by } = input;

  if (!["independent", "split", "flat"].includes(mode))
    throw new Error("invalid mode");
  if (!organiser_email) throw new Error("organiser email required");
  if (!Array.isArray(lines) || lines.length === 0)
    throw new Error("at least one payer required");

  const organiserName = organiser_name || organiser_email;
  const rates = await getRates();

  let splitApt: string | null = null;
  let splitNights: number | null = null;
  let splitAmount: number | null = null;
  let prepared: PreparedLine[];

  if (mode === "flat") {
    const perPerson = input.per_person_minor;
    if (!Number.isInteger(perPerson) || (perPerson as number) <= 0)
      throw new Error("per_person_minor must be a positive integer");
    if (lines.some((l) => !l.payer_email))
      throw new Error("each participant requires an email");
    prepared = lines.map((l) => ({
      apartmentType: null,
      nights: null,
      amountMinor: perPerson as number,
      payerName: l.payer_name || l.payer_email,
      payerEmail: l.payer_email,
    }));
  } else if (mode === "independent") {
    prepared = lines.map((l) => ({
      apartmentType: l.apartment_type ?? null,
      nights: l.nights ?? null,
      amountMinor: lineAmountMinor(l.apartment_type, l.nights, rates),
      payerName: l.payer_name || l.payer_email,
      payerEmail: l.payer_email,
    }));
  } else {
    if (!split) throw new Error("split config required");
    let roomTotal: number;
    if (split.apartment_type && split.nights) {
      // Apartment-based split: price strictly from the catalog rates so a
      // client can never tamper with the total.
      splitApt = split.apartment_type;
      splitNights = split.nights;
      roomTotal = lineAmountMinor(splitApt, splitNights, rates);
    } else if (
      Number.isInteger(split.amount_minor) &&
      (split.amount_minor as number) > 0
    ) {
      // Open-value (gift) split: the total comes from the buyer's chosen amount.
      splitAmount = split.amount_minor as number;
      roomTotal = splitAmount;
    } else {
      throw new Error("split config required");
    }
    const n = lines.length;
    const explicit = lines.every((l) => Number.isInteger(l.share_minor));
    if (explicit) {
      if (lines.some((l) => (l.share_minor as number) <= 0))
        throw new Error("each share must be a positive integer");
      const sum = lines.reduce((s, l) => s + (l.share_minor as number), 0);
      if (sum !== roomTotal)
        throw new Error(
          `shares (${sum}) must sum to room total (${roomTotal})`,
        );
      prepared = lines.map((l) => ({
        apartmentType: null,
        nights: null,
        amountMinor: l.share_minor as number,
        payerName: l.payer_name || l.payer_email,
        payerEmail: l.payer_email,
      }));
    } else {
      const base = Math.floor(roomTotal / n);
      const remainder = roomTotal - base * n;
      prepared = lines.map((l, i) => ({
        apartmentType: null,
        nights: null,
        amountMinor: base + (i === 0 ? remainder : 0),
        payerName: l.payer_name || l.payer_email,
        payerEmail: l.payer_email,
      }));
    }
  }

  const statusToken = token();

  return await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(groupOrders)
      .values({
        orderNumber: newOrderNumber(),
        mode,
        organiserName: organiserName,
        organiserEmail: organiser_email,
        splitApartmentType: splitApt,
        splitNights: splitNights,
        splitAmountMinor: splitAmount,
        currency: CURRENCY,
        dueBy: due_by ? new Date(due_by) : null,
        statusToken,
      })
      .returning();

    const created = [];
    for (const r of prepared) {
      const payTok = token();
      const [row] = await tx
        .insert(voucherLines)
        .values({
          groupOrderId: order.id,
          apartmentType: r.apartmentType,
          nights: r.nights,
          amountMinor: r.amountMinor,
          payerName: r.payerName,
          payerEmail: r.payerEmail,
          payToken: payTok,
        })
        .returning();
      created.push(row);
    }

    return {
      order_id: order.id,
      status_token: statusToken,
      organiser_url: `/group/${statusToken}`,
      lines: created.map((l) => ({
        id: l.id,
        payer_name: l.payerName,
        payer_email: l.payerEmail,
        amount_minor: l.amountMinor,
        pay_link: `/pay/${l.payToken}`,
      })),
    };
  });
}

type CheckoutResult =
  | { url: string }
  | { error: "not_found" | "already_paid" | "closed" };

export async function startCheckout(
  payToken: string,
  origin: string,
): Promise<CheckoutResult> {
  const [line] = await db
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.payToken, payToken));
  if (!line) return { error: "not_found" };

  const [order] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.id, line.groupOrderId));
  if (!order) return { error: "not_found" };

  if (line.status === "paid") return { error: "already_paid" };
  if (line.status === "expired" || order.status !== "open")
    return { error: "closed" };
  if (order.dueBy && new Date(order.dueBy) < new Date())
    return { error: "closed" };

  const descr = line.apartmentType
    ? `Golden Jubilee — ${line.apartmentType.replace("_", " ")}, ${line.nights} night(s)`
    : "Golden Jubilee — group voucher share";

  const stripe = await getUncachableStripeClient();

  // Reuse an existing open Checkout session for this line to avoid minting
  // multiple payable sessions (which could lead to duplicate charges).
  if (line.stripeSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        line.stripeSessionId,
      );
      if (existing.status === "open" && existing.url) {
        return { url: existing.url };
      }
    } catch {
      // Existing session is no longer retrievable; fall through and create one.
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: line.payerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: Number(line.amountMinor),
          product_data: { name: descr },
        },
      },
    ],
    metadata: { line_id: line.id, group_order_id: line.groupOrderId },
    success_url: `${origin}/pay/${payToken}/done?cs={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pay/${payToken}`,
  });

  await db
    .update(voucherLines)
    .set({ stripeSessionId: session.id, updatedAt: new Date() })
    .where(eq(voucherLines.id, line.id));

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}

export async function handleSessionCompleted(
  session: Stripe.Checkout.Session,
  { propagateEmailError = false }: { propagateEmailError?: boolean } = {},
): Promise<void> {
  const lineId = session.metadata?.line_id;
  if (!lineId) return;

  // Capture the hosted Stripe receipt URL for this payment so the client
  // dashboard can show it without a live lookup. Done outside the transaction
  // to avoid holding row locks during a network call; best-effort (null on
  // failure, with an on-demand fallback in the dashboard aggregation).
  let receiptUrl: string | null = null;
  const piId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  if (piId) {
    try {
      const stripe = await getUncachableStripeClient();
      receiptUrl = await fetchReceiptUrlForPaymentIntent(stripe, piId);
    } catch {
      // ignore — dashboard fallback will retrieve it on demand
    }
  }

  // Transition the line (and possibly the order) to paid/complete. We never
  // send email inside the transaction (a network call would hold row locks, and
  // the email could fire while the tx later rolls back). The transition is
  // guarded so only a still-pending line moves forward; a webhook replay of an
  // already-paid line is a no-op here and falls through to the state-based email
  // step below.
  await db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.id, lineId))
      .for("update");
    // Only a still-pending line may transition to paid. Ignore late events for
    // lines already paid or expired (e.g. swept after the deadline).
    if (!line || line.status !== "pending") return;

    const [order] = await tx
      .select()
      .from(groupOrders)
      .where(eq(groupOrders.id, line.groupOrderId))
      .for("update");
    // Ignore payments arriving after the order is no longer open.
    if (!order || order.status !== "open") return;

    if (order.mode === "split") {
      await tx
        .update(voucherLines)
        .set({
          status: "paid",
          paidAt: new Date(),
          receiptUrl,
          updatedAt: new Date(),
        })
        .where(eq(voucherLines.id, line.id));
    } else {
      // independent and flat: each paid line gets its own voucher code.
      await tx
        .update(voucherLines)
        .set({
          status: "paid",
          paidAt: new Date(),
          voucherCode: voucherCode(),
          receiptUrl,
          updatedAt: new Date(),
        })
        .where(eq(voucherLines.id, line.id));
    }

    const [{ c: pending }] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(voucherLines)
      .where(
        and(
          eq(voucherLines.groupOrderId, order.id),
          ne(voucherLines.status, "paid"),
        ),
      );

    if (pending === 0) {
      if (order.mode === "split") {
        await tx
          .update(groupOrders)
          .set({
            status: "complete",
            splitVoucherCode: voucherCode(),
            updatedAt: new Date(),
          })
          .where(eq(groupOrders.id, order.id));
      } else {
        // independent and flat: complete once all lines are paid.
        await tx
          .update(groupOrders)
          .set({ status: "complete", updatedAt: new Date() })
          .where(eq(groupOrders.id, order.id));
      }
    }
  });

  // Decide what to email from the CURRENT persisted state, not from whether this
  // particular call performed the transition. This is what makes a webhook
  // retry recover a previously failed send: if an earlier attempt issued the
  // voucher but the email failed (and released its claim), the replay re-reads
  // the same paid/complete state and sends it. The claim UPDATEs below keep it
  // exactly-once. `propagateEmailError` (webhook only) rethrows so Stripe retries.
  const [freshLine] = await db
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.id, lineId));
  if (!freshLine) return;

  // independent/flat: each paid line carries its own voucher code. Split lines
  // never get a per-line code (only the organiser's master voucher), so this
  // condition naturally skips them.
  if (
    freshLine.status === "paid" &&
    freshLine.voucherCode &&
    freshLine.voucherEmailedAt === null
  ) {
    await emailLineVoucherOnce(
      freshLine.id,
      freshLine.payerEmail,
      freshLine.payerName,
      freshLine.voucherCode,
      propagateEmailError,
    );
  }

  // split: the master voucher belongs to the organiser and is emailed once the
  // order is complete. Triggered by whichever line's event finishes the order.
  const [freshOrder] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.id, freshLine.groupOrderId));
  if (
    freshOrder &&
    freshOrder.mode === "split" &&
    freshOrder.status === "complete" &&
    freshOrder.splitVoucherCode &&
    freshOrder.splitVoucherEmailedAt === null
  ) {
    await emailSplitVoucherOnce(
      freshOrder.id,
      freshOrder.organiserEmail,
      freshOrder.organiserName,
      freshOrder.splitVoucherCode,
      propagateEmailError,
    );
  }
}

/**
 * Atomically claim a paid line's email slot and send its voucher PDF exactly
 * once. The conditional UPDATE (…WHERE voucher_emailed_at IS NULL) means a
 * webhook retry that loses the race sends nothing; a failed send releases the
 * claim so a later retry can resend.
 */
async function emailLineVoucherOnce(
  lineId: string,
  to: string,
  name: string | null,
  code: string,
  propagateError: boolean,
): Promise<void> {
  const claimed = await db
    .update(voucherLines)
    .set({ voucherEmailedAt: new Date() })
    .where(
      and(eq(voucherLines.id, lineId), isNull(voucherLines.voucherEmailedAt)),
    )
    .returning({ id: voucherLines.id });
  if (claimed.length === 0) return;

  try {
    await sendIssuedVoucherEmail({ to, recipientName: name, code });
  } catch (err) {
    // Release the claim so a later attempt (webhook retry) can resend.
    await db
      .update(voucherLines)
      .set({ voucherEmailedAt: null })
      .where(eq(voucherLines.id, lineId));
    logger.error({ err, code }, "Failed to email group line voucher PDF");
    if (propagateError) throw err;
  }
}

/** Same idempotent claim-then-send, for a completed split master voucher. */
async function emailSplitVoucherOnce(
  orderId: string,
  to: string,
  name: string | null,
  code: string,
  propagateError: boolean,
): Promise<void> {
  const claimed = await db
    .update(groupOrders)
    .set({ splitVoucherEmailedAt: new Date() })
    .where(
      and(
        eq(groupOrders.id, orderId),
        isNull(groupOrders.splitVoucherEmailedAt),
      ),
    )
    .returning({ id: groupOrders.id });
  if (claimed.length === 0) return;

  try {
    await sendIssuedVoucherEmail({ to, recipientName: name, code });
  } catch (err) {
    // Release the claim so a later attempt (webhook retry) can resend.
    await db
      .update(groupOrders)
      .set({ splitVoucherEmailedAt: null })
      .where(eq(groupOrders.id, orderId));
    logger.error({ err, code }, "Failed to email split master voucher PDF");
    if (propagateError) throw err;
  }
}

export async function getOrganiserView(statusToken: string) {
  const [order] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.statusToken, statusToken));
  if (!order) return null;

  const lines = await db
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.groupOrderId, order.id))
    .orderBy(asc(voucherLines.createdAt));

  return {
    mode: order.mode,
    status: order.status,
    currency: order.currency,
    organiser_name: order.organiserName,
    due_by: order.dueBy ? order.dueBy.toISOString() : null,
    split_apartment_type: order.splitApartmentType,
    split_nights: order.splitNights,
    split_amount_major:
      order.splitAmountMinor != null
        ? Number(order.splitAmountMinor) / MINOR_PER_MAJOR
        : null,
    split_voucher_code: order.splitVoucherCode,
    paid_count: lines.filter((l) => l.status === "paid").length,
    total_count: lines.length,
    lines: lines.map((l) => ({
      id: l.id,
      payer_name: l.payerName,
      payer_email: l.payerEmail,
      amount_major: Number(l.amountMinor) / MINOR_PER_MAJOR,
      status: l.status,
      voucher_code: l.voucherCode,
      credit_code: l.creditCode,
      apartment_type: l.apartmentType,
      nights: l.nights,
      pay_link: `/pay/${l.payToken}`,
    })),
  };
}

export async function getPayLine(payToken: string) {
  const [line] = await db
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.payToken, payToken));
  if (!line) return null;

  const [order] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.id, line.groupOrderId));
  if (!order) return null;

  const dueExpired = order.dueBy ? new Date(order.dueBy) < new Date() : false;
  const payable =
    line.status === "pending" && order.status === "open" && !dueExpired;

  const description = line.apartmentType
    ? `Golden Jubilee — ${line.apartmentType.replace("_", " ")}, ${line.nights} night(s)`
    : order.mode === "split"
      ? "Golden Jubilee — group voucher share"
      : "Golden Jubilee — group voucher";

  return {
    payer_name: line.payerName,
    amount_major: Number(line.amountMinor) / MINOR_PER_MAJOR,
    currency: order.currency,
    description,
    status: line.status,
    payable,
    voucher_code: line.voucherCode,
    organiser_name: order.organiserName,
    order_number: order.orderNumber,
  };
}

export async function resendLine(statusToken: string, lineId: string) {
  const [order] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.statusToken, statusToken));
  if (!order) return null;

  const [line] = await db
    .select()
    .from(voucherLines)
    .where(
      and(
        eq(voucherLines.id, lineId),
        eq(voucherLines.groupOrderId, order.id),
      ),
    );
  if (!line) return null;

  return {
    pay_link: `/pay/${line.payToken}`,
    payer_email: line.payerEmail,
    status: line.status,
  };
}

/**
 * Owner-scoped reminder: re-surfaces a participant's payment link for a group
 * order the authenticated organiser owns. The order is matched by its id AND
 * the verified organiser email (case-insensitive), so an organiser can only
 * ever act on their own orders. Returns null if the order isn't owned by this
 * email or the line doesn't belong to it.
 */
export async function resendLineForOrganiser(
  organiserEmail: string,
  orderId: string,
  lineId: string,
) {
  const normalized = organiserEmail.trim().toLowerCase();
  const [order] = await db
    .select()
    .from(groupOrders)
    .where(
      and(
        eq(groupOrders.id, orderId),
        eq(sql`lower(${groupOrders.organiserEmail})`, normalized),
      ),
    );
  if (!order) return null;

  const [line] = await db
    .select()
    .from(voucherLines)
    .where(
      and(
        eq(voucherLines.id, lineId),
        eq(voucherLines.groupOrderId, order.id),
      ),
    );
  if (!line) return null;

  return {
    pay_link: `/pay/${line.payToken}`,
    payer_email: line.payerEmail,
    status: line.status,
  };
}

export async function sweepExpired(now = new Date()) {
  const orders = await db
    .select()
    .from(groupOrders)
    .where(
      and(eq(groupOrders.status, "open"), lt(groupOrders.dueBy, now)),
    );

  for (const order of orders) {
    await db.transaction(async (tx) => {
      await tx
        .update(voucherLines)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(voucherLines.groupOrderId, order.id),
            eq(voucherLines.status, "pending"),
          ),
        );

      if (order.mode === "split") {
        const paid = await tx
          .select({ id: voucherLines.id })
          .from(voucherLines)
          .where(
            and(
              eq(voucherLines.groupOrderId, order.id),
              eq(voucherLines.status, "paid"),
              isNull(voucherLines.creditCode),
            ),
          );
        for (const p of paid) {
          await tx
            .update(voucherLines)
            .set({ creditCode: creditCode(), updatedAt: new Date() })
            .where(eq(voucherLines.id, p.id));
        }
      }

      await tx
        .update(groupOrders)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(groupOrders.id, order.id));
    });
  }

  return { swept: orders.length };
}

export async function getRateTable() {
  const rates = await getRates();
  return {
    currency: CURRENCY,
    minor_per_major: MINOR_PER_MAJOR,
    rates: {
      one_bedroom: rates.one_bedroom,
      two_bedroom: rates.two_bedroom,
    },
  };
}
