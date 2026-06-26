import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import {
  db,
  storeOrders,
  storeInstallments,
  storeVouchers,
} from "@workspace/db";
import type Stripe from "stripe";
import {
  getUncachableStripeClient,
  getStripePublishableKey,
  fetchReceiptUrlForPaymentIntent,
} from "./stripeClient";
import {
  GIFT,
  SETTINGS,
  SYMBOLS,
  getEffectiveCatalog,
  priceFor,
  nameFor,
} from "./storeCatalog";
import { logger } from "./logger";
import {
  sendActionRequiredEmail,
  sendPaymentFailedEmail,
  sendDepositReceivedEmail,
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
  };
}

interface CreateOrderInput {
  product_id?: string | null;
  type?: string;
  amount?: number | null;
  nights?: number | null;
  plan?: string | null;
  name: string;
  email: string;
}

type CreateOrderResult =
  | { order_id: string; client_secret: string }
  | { error: "invalid_buyer" | "invalid_selection" | "payments_unavailable" };

export async function createStoreOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const { product_id, type = "package", amount, nights, plan, name, email } = input;
  if (!name?.trim() || !email?.includes("@")) {
    return { error: "invalid_buyer" };
  }

  // Price comes from the catalog, never from the client.
  const total = await priceFor({
    productId: product_id ?? undefined,
    type,
    amount: amount ?? undefined,
    nights: nights ?? undefined,
  });
  if (total === null) return { error: "invalid_selection" };
  const productName = nameFor({
    productId: product_id ?? undefined,
    type,
    nights: nights ?? undefined,
  });

  const payInN =
    String(plan) === String(SETTINGS.instalments) ||
    Number(plan) === SETTINGS.instalments;
  const installments = payInN ? SETTINGS.instalments : 1;
  const per = Math.round((total / installments) * 100) / 100;
  const firstAmount = installments === 1 ? total : per;

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
      productId: product_id ?? null,
      productName,
      type,
      buyerName: name,
      buyerEmail: email,
      currency: CUR,
      totalMinor: toMinor(total),
      installments,
      stripeCustomerId: customer.id,
      status: "pending",
    })
    .returning();

  const pi = await stripe.paymentIntents.create(
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
    paid_instalments: fresh.paidInstalments,
    installments: fresh.installments,
    voucher: voucher ? { code: voucher.code, status: voucher.status } : null,
  };
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
          const totalMinor = Number(order.totalMinor);
          const per = Math.round(totalMinor / order.installments);
          const rows = [];
          for (let i = 2; i <= order.installments; i++) {
            const last = i === order.installments;
            const amountMinor = last
              ? totalMinor - per * (order.installments - 1)
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
    }
  } else if (order.paidInstalments < instalmentNo) {
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
    await db
      .update(storeOrders)
      .set({ paidInstalments: instalmentNo, updatedAt: new Date() })
      .where(eq(storeOrders.id, order.id));
  }

  const fullyPaid = instalmentNo >= order.installments;
  if (fullyPaid && order.status !== "paid") {
    await db
      .update(storeOrders)
      .set({ status: "paid", updatedAt: new Date() })
      .where(eq(storeOrders.id, order.id));
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

    // Atomically claim the row so a concurrent run or a pending webhook
    // cannot trigger a second charge for the same instalment. Only proceed
    // if it is still in a chargeable state.
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
    if (claimed.length === 0) continue;
    processed++;

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
      // Persist the PI id; success is finalised by the webhook (or confirm).
      await db
        .update(storeInstallments)
        .set({ paymentIntentId: pi.id })
        .where(eq(storeInstallments.id, inst.id));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "authentication_required") {
        await db
          .update(storeInstallments)
          .set({ status: "needs_action" })
          .where(eq(storeInstallments.id, inst.id));
        await sendActionRequiredEmail(order, inst);
      } else {
        await db
          .update(storeInstallments)
          .set({
            status: "failed",
            lastError: err instanceof Error ? err.message : "charge failed",
            attempts: inst.attempts + 1,
          })
          .where(eq(storeInstallments.id, inst.id));
        await sendPaymentFailedEmail(order, inst);
      }
      logger.warn({ err, instalmentId: inst.id }, "Instalment charge failed");
    }
  }
  return { processed };
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
