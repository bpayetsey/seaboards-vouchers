import crypto from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne } from "drizzle-orm";
import {
  db,
  storeOrders,
  storeInstallments,
  storeVouchers,
} from "@workspace/db";
import type { StoreOrder, StoreInstallment } from "@workspace/db";
import { newOrderNumber } from "@workspace/db";
import type Stripe from "stripe";
import {
  getUncachableStripeClient,
  getStripePublishableKey,
  fetchReceiptUrlForPaymentIntent,
} from "./stripeClient";
import {
  GIFT,
  DAY_PASSES,
  SETTINGS,
  SYMBOLS,
  getEffectiveCatalog,
  priceFor,
  nameFor,
  paxFor,
  isDatableDayPass,
} from "./storeCatalog";
import {
  getAvailability,
  spendCredit,
  restoreReservedCredit,
  ensureDayPassBooking,
} from "./dayPass";
import { logger } from "./logger";
import { getPromoBanner } from "./siteContent";
import {
  sendActionRequiredEmail,
  sendPaymentFailedEmail,
  sendDepositReceivedEmail,
  sendInstalmentReceiptEmail,
} from "./storeEmail";
import { sendIssuedVoucherEmail } from "./voucherEmail";

const CUR = SETTINGS.currency;
const toMinor = (major: number): number => Math.round(Number(major) * 100);
const newCode = (): string =>
  "SB50-" +
  Array.from({ length: 3 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase(),
  ).join("-");

export async function getStorefrontConfig() {
  const publishableKey = await getStripePublishableKey();
  return {
    publishable_key: publishableKey,
    payments_enabled: publishableKey !== "",
    currency: CUR,
    symbol: SYMBOLS[CUR] ?? "",
    instalments: SETTINGS.instalments,
    interval_days: SETTINGS.intervalDays,
    catalog: await getEffectiveCatalog(),
    gift: GIFT,
    day_passes: DAY_PASSES,
    promo_banner: await getPromoBanner(),
  };
}

interface CreateOrderInput {
  product_id?: string | null;
  type?: string;
  amount?: number | null;
  nights?: number | null;
  adults?: number | null;
  children?: number | null;
  extension?: boolean | null;
  plan?: string | null;
  name: string;
  email: string;
  /** Day-pass visit date (YYYY-MM-DD). Null/omitted = undated (decide later). */
  visit_date?: string | null;
  /** Account credit to apply, in minor units. Requires an authenticated buyer. */
  credit_minor?: number | null;
  /** Verified email of the logged-in buyer, set server-side (never trusted from body). */
  authed_email?: string | null;
}

type CreateOrderResult =
  | { order_id: string; client_secret: string }
  | {
      error:
        | "invalid_buyer"
        | "invalid_selection"
        | "payments_unavailable"
        | "date_unavailable"
        | "credit_requires_auth"
        | "credit_too_large"
        | "insufficient_credit";
    };

export async function createStoreOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const {
    product_id,
    type = "package",
    amount,
    nights,
    adults,
    children,
    extension,
    plan,
    name,
    email,
    visit_date,
    credit_minor,
    authed_email,
  } = input;
  if (!name?.trim() || !email?.includes("@")) {
    return { error: "invalid_buyer" };
  }

  // Price comes from the catalog, never from the client.
  const total = await priceFor({
    productId: product_id ?? undefined,
    type,
    amount: amount ?? undefined,
    nights: nights ?? undefined,
    adults: adults ?? undefined,
    children: children ?? undefined,
    extension: extension ?? undefined,
  });
  if (total === null) return { error: "invalid_selection" };
  const productName = nameFor({
    productId: product_id ?? undefined,
    type,
    nights: nights ?? undefined,
    adults: adults ?? undefined,
    children: children ?? undefined,
    extension: extension ?? undefined,
  });

  // Day-pass party size — server-validated, never client-driven.
  const pax =
    type === "day_pass"
      ? paxFor({
          productId: product_id ?? undefined,
          type,
          adults: adults ?? undefined,
          children: children ?? undefined,
        })
      : null;
  if (type === "day_pass" && pax === null) return { error: "invalid_selection" };

  // Only the per-person passes can carry a visit date; validate availability now
  // (final capacity is re-checked atomically when the booking materialises).
  let visitDate: string | null = null;
  if (visit_date && isDatableDayPass(product_id)) {
    const [day] = await getAvailability(visit_date, visit_date, pax ?? 1);
    if (!day || !day.bookable) return { error: "date_unavailable" };
    visitDate = visit_date;
  }

  const totalMinor = toMinor(total);

  // Validate any requested credit before creating Stripe/order records so we
  // don't leave orphans. Credit is strictly account-scoped: the buyer must be
  // logged in and the order email must match their verified email.
  let creditMinor = 0;
  if (credit_minor && Number(credit_minor) > 0) {
    const buyerEmail = email.trim().toLowerCase();
    if (!authed_email || authed_email.trim().toLowerCase() !== buyerEmail) {
      return { error: "credit_requires_auth" };
    }
    creditMinor = Math.floor(Number(credit_minor));
    // Must leave a positive cash amount for Stripe to charge.
    if (creditMinor >= totalMinor) return { error: "credit_too_large" };
  }

  const cashMinor = totalMinor - creditMinor;
  const cashTotal = cashMinor / 100;
  const payInN =
    String(plan) === String(SETTINGS.instalments) ||
    Number(plan) === SETTINGS.instalments;
  const installments = payInN ? SETTINGS.instalments : 1;
  const per = Math.round((cashTotal / installments) * 100) / 100;
  const firstAmount = installments === 1 ? cashTotal : per;

  let stripe: Stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch {
    return { error: "payments_unavailable" };
  }

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { campaign: "sb50" },
  });

  const [order] = await db
    .insert(storeOrders)
    .values({
      orderNumber: newOrderNumber(),
      productId: product_id ?? null,
      productName,
      type,
      buyerName: name,
      buyerEmail: email,
      currency: CUR,
      totalMinor,
      creditAppliedMinor: creditMinor,
      dayPassPax: pax,
      dayPassVisitDate: visitDate,
      installments,
      stripeCustomerId: customer.id,
      status: "pending",
    })
    .returning();

  // Reserve the credit atomically now that we have an order id to reference.
  // The conditional decrement prevents concurrent double-spend; on failure the
  // order is abandoned and no charge is created.
  if (creditMinor > 0) {
    const spent = await spendCredit({
      email,
      currency: CUR,
      amountMinor: creditMinor,
      reason: "checkout",
      orderId: order.id,
    });
    if (!spent) {
      await db
        .update(storeOrders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(storeOrders.id, order.id));
      return { error: "insufficient_credit" };
    }
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: toMinor(firstAmount),
        currency: CUR,
        customer: customer.id,
        // card-only: needed to save the card for off-session instalments
        payment_method_types: ["card"],
        setup_future_usage: payInN ? "off_session" : undefined,
        metadata: {
          orderId: order.id,
          instalmentNo: "1",
          instalments: String(installments),
        },
      },
      { idempotencyKey: `store-order-${order.id}-i1` },
    );
  } catch (err) {
    // Roll the reserved credit back so a failed payment setup doesn't strand it.
    if (creditMinor > 0) {
      await restoreReservedCredit({
        id: order.id,
        buyerEmail: email,
        currency: CUR,
        creditAppliedMinor: creditMinor,
      });
      await db
        .update(storeOrders)
        .set({ creditAppliedMinor: 0, status: "cancelled", updatedAt: new Date() })
        .where(eq(storeOrders.id, order.id));
    }
    throw err;
  }

  await db
    .update(storeOrders)
    .set({ firstPaymentIntentId: pi.id, updatedAt: new Date() })
    .where(eq(storeOrders.id, order.id));

  if (!pi.client_secret) {
    throw new Error("Stripe did not return a client secret");
  }
  return { order_id: order.id, client_secret: pi.client_secret };
}

type ConfirmResult =
  | {
      status: string;
      order_number: string | null;
      paid_instalments: number;
      installments: number;
      voucher: { code: string; status: string } | null;
    }
  | { error: "not_found" };

export async function confirmStoreOrder(
  orderId: string,
): Promise<ConfirmResult> {
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, orderId));
  if (!order) return { error: "not_found" };

  if (order.firstPaymentIntentId) {
    const stripe = await getUncachableStripeClient();
    const pi = await stripe.paymentIntents.retrieve(order.firstPaymentIntentId);
    if (pi.status === "succeeded") await processPaidIntent(pi);
  }

  const [voucher] = await db
    .select()
    .from(storeVouchers)
    .where(eq(storeVouchers.orderId, order.id));
  const [fresh] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, order.id));

  return {
    status: fresh.status,
    order_number: fresh.orderNumber,
    paid_instalments: fresh.paidInstalments,
    installments: fresh.installments,
    voucher: voucher ? { code: voucher.code, status: voucher.status } : null,
  };
}

/**
 * Credit applied at checkout is reserved (decremented) when the order is created
 * so concurrent checkouts can't double-spend it. If the buyer then abandons the
 * payment, that reservation would otherwise be stranded forever. This sweep is
 * the guaranteed release: any still-`pending` order that never had a successful
 * first payment (`paidInstalments` 0) and is older than the grace window has its
 * reserved credit returned and the order expired.
 *
 * Idempotency & race-safety: the order is flipped `pending` -> `expired` with a
 * conditional UPDATE that also requires `paidInstalments = 0`; only the call that
 * actually transitions the row posts the reversal, so it runs at most once. A
 * concurrent first payment sets `paidInstalments = 1`, which makes the WHERE no
 * longer match, so a paid order is never reversed. The generous grace window
 * keeps this well clear of the few-minutes card-confirmation latency.
 */
const RESERVED_CREDIT_GRACE_MS = 60 * 60 * 1000;

export async function releaseStaleReservedCredit(): Promise<number> {
  const cutoff = new Date(Date.now() - RESERVED_CREDIT_GRACE_MS);
  const candidates = await db
    .select()
    .from(storeOrders)
    .where(
      and(
        eq(storeOrders.status, "pending"),
        eq(storeOrders.paidInstalments, 0),
        gt(storeOrders.creditAppliedMinor, 0),
        lt(storeOrders.createdAt, cutoff),
      ),
    );

  let released = 0;
  for (const order of candidates) {
    const reversedMinor = Number(order.creditAppliedMinor);
    const [claimed] = await db
      .update(storeOrders)
      .set({ status: "expired", creditAppliedMinor: 0, updatedAt: new Date() })
      .where(
        and(
          eq(storeOrders.id, order.id),
          eq(storeOrders.status, "pending"),
          eq(storeOrders.paidInstalments, 0),
        ),
      )
      .returning({ id: storeOrders.id });
    if (!claimed) continue; // lost the race (e.g. payment landed) — leave it.

    await restoreReservedCredit({
      id: order.id,
      buyerEmail: order.buyerEmail,
      currency: order.currency,
      creditAppliedMinor: reversedMinor,
    });
    released += 1;
  }
  return released;
}

/**
 * Shared, idempotent: a PaymentIntent (any instalment) has succeeded.
 *
 * `propagateEmailError` controls what happens if the voucher email send fails:
 * the webhook passes `true` so the failure surfaces (non-2xx) and Stripe retries
 * the event, guaranteeing eventual delivery. Buyer/admin-facing callers (confirm
 * fallback, admin retry) leave it `false` so a transient email outage never
 * fails their request — the webhook is the durable retrier.
 */
export async function processPaidIntent(
  pi: Stripe.PaymentIntent,
  { propagateEmailError = false }: { propagateEmailError?: boolean } = {},
): Promise<void> {
  const orderId = pi.metadata?.orderId;
  if (!orderId) return;

  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, orderId));
  if (!order) return;

  const instalmentNo = Number(pi.metadata?.instalmentNo || 1);

  // Resolve the hosted Stripe receipt URL for this payment. Prefer the already
  // expanded latest charge; otherwise retrieve it. Best-effort (null on
  // failure), with an on-demand fallback in the dashboard aggregation.
  let receiptUrl: string | null = null;
  try {
    const charge = pi.latest_charge;
    if (charge && typeof charge !== "string" && charge.receipt_url) {
      receiptUrl = charge.receipt_url;
    } else {
      const stripe = await getUncachableStripeClient();
      receiptUrl = await fetchReceiptUrlForPaymentIntent(stripe, pi.id);
    }
  } catch {
    // ignore — dashboard fallback will retrieve it on demand
  }

  if (instalmentNo === 1) {
    if (order.paidInstalments < 1) {
      const pm =
        typeof pi.payment_method === "string"
          ? pi.payment_method
          : pi.payment_method?.id;
      if (pm) {
        const stripe = await getUncachableStripeClient();
        await stripe.customers
          .update(order.stripeCustomerId, {
            invoice_settings: { default_payment_method: pm },
          })
          .catch(() => {});
      }
      await db
        .update(storeOrders)
        .set({
          stripePaymentMethodId: pm ?? null,
          firstReceiptUrl: receiptUrl ?? order.firstReceiptUrl,
          paidInstalments: 1,
          updatedAt: new Date(),
        })
        .where(eq(storeOrders.id, order.id));

      // Build instalments 2..N once.
      if (order.installments > 1) {
        const existing = await db
          .select({ id: storeInstallments.id })
          .from(storeInstallments)
          .where(eq(storeInstallments.orderId, order.id));
        if (existing.length === 0) {
          // Instalments are charged against the cash due (order total minus any
          // account credit applied at checkout), matching the first payment
          // computed in createStoreOrder. Using the gross total here would
          // overcharge customers who paid partly with credit.
          const cashMinor =
            Number(order.totalMinor) - Number(order.creditAppliedMinor ?? 0);
          const per = Math.round(cashMinor / order.installments);
          const rows = [];
          for (let i = 2; i <= order.installments; i++) {
            const last = i === order.installments;
            const amountMinor = last
              ? cashMinor - per * (order.installments - 1)
              : per;
            const dueAt = new Date();
            dueAt.setDate(dueAt.getDate() + (i - 1) * SETTINGS.intervalDays);
            rows.push({
              orderId: order.id,
              number: i,
              amountMinor,
              dueAt,
              status: "scheduled",
            });
          }
          await db.insert(storeInstallments).values(rows);
        }
      }

      // Materialise the day-pass booking on the first successful payment
      // (idempotent). Re-reads the freshly-updated order so it sees the stored
      // pax / visit date.
      if (order.type === "day_pass") {
        const [fresh] = await db
          .select()
          .from(storeOrders)
          .where(eq(storeOrders.id, order.id));
        if (fresh) await ensureDayPassBooking(fresh);
      }
    }
  } else {
    await db
      .update(storeInstallments)
      .set({ status: "paid", paidAt: new Date(), receiptUrl })
      .where(
        and(
          eq(storeInstallments.orderId, order.id),
          eq(storeInstallments.number, instalmentNo),
          ne(storeInstallments.status, "paid"),
        ),
      );
  }

  // Recompute paid progress from the actual paid slots rather than treating the
  // instalment number as a high-water mark. Advance payments let a client pay a
  // later instalment before an earlier one, so a number-based count would both
  // mis-report progress and prematurely mark the order fully paid (activating
  // the voucher while an earlier instalment is still unpaid). Slot 1 is the
  // first payment (always cleared before any instalment 2..N can be charged);
  // slots 2..N are storeInstallments rows.
  let paidCount = 1;
  if (order.installments > 1) {
    const paidRows = await db
      .select({ id: storeInstallments.id })
      .from(storeInstallments)
      .where(
        and(
          eq(storeInstallments.orderId, order.id),
          eq(storeInstallments.status, "paid"),
        ),
      );
    paidCount = 1 + paidRows.length;
  }
  await db
    .update(storeOrders)
    .set({ paidInstalments: paidCount, updatedAt: new Date() })
    .where(eq(storeOrders.id, order.id));

  const fullyPaid = paidCount >= order.installments;
  if (fullyPaid && order.status !== "paid") {
    await db
      .update(storeOrders)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(storeOrders.id, order.id));
  }

  // Per-instalment payment receipt for an upcoming instalment (2..N) that did
  // NOT complete the plan. The first payment has its own "plan started" notice
  // and the final payment delivers the voucher PDF, so those milestones are not
  // double-emailed here. Sent regardless of the voucher issue policy, so it must
  // happen before the `shouldExist` early-return below. The receipt is claimed
  // with a conditional UPDATE on the instalment's `receiptEmailedAt` so the daily
  // charge job's webhook and a client's advance payment can never double-send;
  // on a delivery failure the claim is released so a later run can retry.
  if (instalmentNo >= 2 && !fullyPaid) {
    const [inst] = await db
      .select()
      .from(storeInstallments)
      .where(
        and(
          eq(storeInstallments.orderId, order.id),
          eq(storeInstallments.number, instalmentNo),
        ),
      );
    if (inst && inst.status === "paid") {
      const [claimed] = await db
        .update(storeInstallments)
        .set({ receiptEmailedAt: new Date() })
        .where(
          and(
            eq(storeInstallments.id, inst.id),
            isNull(storeInstallments.receiptEmailedAt),
          ),
        )
        .returning({ id: storeInstallments.id });
      if (claimed) {
        const delivered = await sendInstalmentReceiptEmail(
          order,
          inst,
          inst.receiptUrl ?? receiptUrl,
        );
        if (!delivered) {
          await db
            .update(storeInstallments)
            .set({ receiptEmailedAt: null })
            .where(eq(storeInstallments.id, inst.id));
          logger.warn(
            { instalmentId: inst.id },
            "instalment receipt email failed to send; claim rolled back for retry",
          );
        }
      }
    }
  }

  // Decide whether a voucher should exist yet, and in which state.
  //  - Fully paid: the voucher must exist and be "active" (regardless of the
  //    issue policy). This is the key Pay-in-3 "fully paid" moment.
  //  - Deposit policy, first instalment, not yet fully paid: issue a "pending"
  //    voucher so the buyer knows their plan has started.
  // Any other intermediate instalment under the "paid" policy issues nothing.
  const shouldExist =
    fullyPaid || (SETTINGS.issueOn === "deposit" && instalmentNo === 1);
  if (!shouldExist) return;

  const targetStatus = fullyPaid ? "active" : "pending";

  const [existing] = await db
    .select()
    .from(storeVouchers)
    .where(eq(storeVouchers.orderId, order.id));

  let voucher;
  if (existing) {
    [voucher] = await db
      .update(storeVouchers)
      .set({ status: targetStatus })
      .where(eq(storeVouchers.id, existing.id))
      .returning();
  } else {
    [voucher] = await db
      .insert(storeVouchers)
      .values({
        orderId: order.id,
        code: newCode(),
        valueMinor: Number(order.totalMinor),
        currency: order.currency,
        status: targetStatus,
        expiresAt: new Date(Date.now() + 365 * 864e5),
      })
      .returning();
  }

  // Deposit ("plan started") milestone, best-effort. Under the deposit-issue
  // policy the voucher exists as "pending" after the first payment; let the
  // buyer know their plan has started. Claim the milestone with a conditional
  // UPDATE so the notice is sent at most once across webhook + confirm retries;
  // on failure clear the claim so a later run can re-attempt.
  if (!fullyPaid && voucher.status === "pending") {
    const [claimed] = await db
      .update(storeVouchers)
      .set({ pendingEmailedAt: new Date() })
      .where(
        and(
          eq(storeVouchers.id, voucher.id),
          isNull(storeVouchers.pendingEmailedAt),
        ),
      )
      .returning({ id: storeVouchers.id });
    if (claimed) {
      const delivered = await sendDepositReceivedEmail(order);
      if (!delivered) {
        await db
          .update(storeVouchers)
          .set({ pendingEmailedAt: null })
          .where(eq(storeVouchers.id, voucher.id));
        logger.warn(
          { voucherId: voucher.id },
          "deposit email failed to send; claim rolled back for retry",
        );
      }
    }
  }

  // Email the voucher PDF once the voucher is fully usable (active). For
  // deposit-issue policy the row exists earlier as "pending"; we wait until the
  // final instalment clears so the buyer receives a redeemable voucher.
  if (voucher.status === "active") {
    await emailVoucherOnce(
      voucher.id,
      order.buyerEmail,
      order.buyerName,
      voucher.code,
      propagateEmailError,
    );
  }
}

/**
 * Atomically claim the storefront voucher's email slot and send the PDF exactly
 * once. The conditional UPDATE (…WHERE voucher_emailed_at IS NULL) means a
 * concurrent webhook retry or confirm fallback that loses the race sends
 * nothing. If the send fails the claim is released so a later retry can resend.
 */
async function emailVoucherOnce(
  voucherId: string,
  to: string,
  recipientName: string | null,
  code: string,
  propagateError: boolean,
): Promise<void> {
  const claimed = await db
    .update(storeVouchers)
    .set({ voucherEmailedAt: new Date() })
    .where(
      and(eq(storeVouchers.id, voucherId), isNull(storeVouchers.voucherEmailedAt)),
    )
    .returning({ id: storeVouchers.id });
  if (claimed.length === 0) return;

  try {
    await sendIssuedVoucherEmail({ to, recipientName, code });
  } catch (err) {
    // Release the claim so a later attempt (webhook retry) can resend.
    await db
      .update(storeVouchers)
      .set({ voucherEmailedAt: null })
      .where(eq(storeVouchers.id, voucherId));
    logger.error({ err, code }, "Failed to email storefront voucher PDF");
    if (propagateError) throw err;
  }
}

type ChargeOutcome =
  | { ok: true }
  | { ok: false; reason: "skipped" }
  | { ok: false; reason: "needs_action" }
  | { ok: false; reason: "failed"; error: string };

/**
 * Charge a single instalment off-session against the buyer's saved card.
 *
 * This is the single charging primitive shared by the daily job and the
 * client-triggered advance-payment path. Both acquire the SAME atomic status
 * claim (UPDATE … SET status='charging' WHERE status IN ('scheduled','failed'))
 * AND use the SAME Stripe idempotency key, so the two paths can never produce a
 * double charge for one instalment: whoever claims the row first proceeds and
 * the other gets `skipped`.
 *
 * When `finalize` is true (advance path) a synchronously-succeeded PI is
 * finalised immediately via `processPaidIntent` for instant UI feedback; the
 * daily job leaves `finalize` false and lets the webhook finalise. On failure
 * the row is moved off `charging` (to `failed`/`needs_action`) so it is never
 * stuck and can be retried.
 */
async function chargeInstalmentRow(
  order: StoreOrder,
  inst: StoreInstallment,
  { finalize }: { finalize: boolean },
): Promise<ChargeOutcome> {
  if (!order.stripePaymentMethodId) {
    return { ok: false, reason: "failed", error: "no_payment_method" };
  }

  const claimed = await db
    .update(storeInstallments)
    .set({ status: "charging" })
    .where(
      and(
        eq(storeInstallments.id, inst.id),
        inArray(storeInstallments.status, ["scheduled", "failed"]),
      ),
    )
    .returning({ id: storeInstallments.id });
  if (claimed.length === 0) return { ok: false, reason: "skipped" };

  try {
    const stripe = await getUncachableStripeClient();
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
      { idempotencyKey: `store-order-${order.id}-i${inst.number}` },
    );
    await db
      .update(storeInstallments)
      .set({ paymentIntentId: pi.id })
      .where(eq(storeInstallments.id, inst.id));
    if (finalize && pi.status === "succeeded") {
      await processPaidIntent(pi);
    }
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "authentication_required") {
      await db
        .update(storeInstallments)
        .set({ status: "needs_action" })
        .where(eq(storeInstallments.id, inst.id));
      await sendActionRequiredEmail(order, inst);
      logger.warn({ err, instalmentId: inst.id }, "Instalment charge failed");
      return { ok: false, reason: "needs_action" };
    }
    const message = err instanceof Error ? err.message : "charge failed";
    await db
      .update(storeInstallments)
      .set({
        status: "failed",
        lastError: message,
        attempts: inst.attempts + 1,
      })
      .where(eq(storeInstallments.id, inst.id));
    await sendPaymentFailedEmail(order, inst);
    logger.warn({ err, instalmentId: inst.id }, "Instalment charge failed");
    return { ok: false, reason: "failed", error: message };
  }
}

/** Daily job: charge due instalments off-session. */
export async function chargeDueInstalments(): Promise<{ processed: number }> {
  const due = await db
    .select()
    .from(storeInstallments)
    .where(
      and(
        inArray(storeInstallments.status, ["scheduled", "failed"]),
        lte(storeInstallments.dueAt, new Date()),
      ),
    );

  let processed = 0;
  for (const inst of due) {
    const [order] = await db
      .select()
      .from(storeOrders)
      .where(eq(storeOrders.id, inst.orderId));
    if (!order || !order.stripePaymentMethodId) continue;

    // Success is finalised by the webhook (finalize: false).
    const outcome = await chargeInstalmentRow(order, inst, { finalize: false });
    if (outcome.ok || outcome.reason !== "skipped") processed++;
  }
  return { processed };
}

export type PayInstalmentResult = {
  number: number;
  status: "paid" | "skipped" | "needs_action" | "failed";
  error?: string;
};

/**
 * Client-triggered advance payment of upcoming "Pay in 3" instalments. Scoped
 * to the buyer's own email. Charges the requested instalment numbers (or all
 * remaining upcoming instalments when `numbers` is omitted) immediately against
 * the saved card, in ascending order, finalising each on success. Shares the
 * exact atomic claim used by the daily job, so it can never double-charge.
 */
export async function payInstalmentsForOrder(
  email: string,
  orderId: string,
  numbers?: number[],
): Promise<
  { error: "not_found" } | { results: PayInstalmentResult[] }
> {
  const normalizedEmail = email.trim().toLowerCase();
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(eq(storeOrders.id, orderId));
  if (!order || order.buyerEmail.trim().toLowerCase() !== normalizedEmail) {
    return { error: "not_found" };
  }

  // Only scheduled/failed instalments are claimable — this matches the daily
  // job's claim exactly. (A row already in `charging`/`paid` is intentionally
  // not picked so the two paths cannot collide.)
  let upcoming = await db
    .select()
    .from(storeInstallments)
    .where(
      and(
        eq(storeInstallments.orderId, order.id),
        inArray(storeInstallments.status, ["scheduled", "failed"]),
      ),
    )
    .orderBy(asc(storeInstallments.number));

  if (numbers && numbers.length > 0) {
    const want = new Set(numbers);
    upcoming = upcoming.filter((i) => want.has(i.number));
  }

  const results: PayInstalmentResult[] = [];
  for (const inst of upcoming) {
    // Re-read the order so the saved card / status reflect any instalment
    // finalised earlier in this same loop.
    const [current] = await db
      .select()
      .from(storeOrders)
      .where(eq(storeOrders.id, order.id));
    if (!current) break;
    const outcome = await chargeInstalmentRow(current, inst, {
      finalize: true,
    });
    if (outcome.ok) {
      results.push({ number: inst.number, status: "paid" });
    } else if (outcome.reason === "failed") {
      results.push({
        number: inst.number,
        status: "failed",
        error: outcome.error,
      });
    } else {
      results.push({ number: inst.number, status: outcome.reason });
    }
  }
  return { results };
}

export async function getAdminOrders() {
  const orders = await db
    .select()
    .from(storeOrders)
    .orderBy(desc(storeOrders.createdAt))
    .limit(100);

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
    result.push({
      id: order.id,
      product_name: order.productName,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      currency: order.currency,
      total_major: Number(order.totalMinor) / 100,
      installments: order.installments,
      paid_instalments: order.paidInstalments,
      status: order.status,
      created_at: order.createdAt.toISOString(),
      schedule: schedule.map((s) => ({
        number: s.number,
        amount_major: Number(s.amountMinor) / 100,
        due_at: s.dueAt.toISOString(),
        status: s.status,
      })),
      voucher: voucher
        ? { code: voucher.code, status: voucher.status }
        : null,
    });
  }
  return { orders: result };
}
