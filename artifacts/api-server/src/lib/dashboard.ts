import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  groupOrders,
  voucherLines,
  storeOrders,
  storeInstallments,
  storeVouchers,
} from "@workspace/db";
import {
  getUncachableStripeClient,
  fetchReceiptUrlForPaymentIntent,
  fetchReceiptUrlForSession,
} from "./stripeClient";

export interface DashboardVoucher {
  kind: "voucher" | "credit";
  code: string;
  source: "storefront" | "group";
  status: string;
  currency: string;
  value_minor: number | null;
  expires_at: string | null;
  created_at: string | null;
}

export interface DashboardPayment {
  id: string;
  source: "storefront" | "group";
  description: string;
  amount_minor: number;
  currency: string;
  status: string;
  paid_at: string | null;
  receipt_url: string | null;
}

export interface DashboardView {
  email: string;
  vouchers: DashboardVoucher[];
  payments: DashboardPayment[];
}

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Status for a not-yet-paid storefront order's first payment. */
const orderPendingStatus = (orderStatus: string): string =>
  orderStatus === "expired" ? "expired" : "pending";

/**
 * Normalises a stored instalment status into a client-facing one. Internal
 * transient states ("scheduled"/"charging") read as "pending"; real outcomes
 * ("paid"/"failed"/"expired") are preserved.
 */
const instalmentStatus = (status: string): string => {
  if (status === "scheduled" || status === "charging") return "pending";
  return status;
};

/**
 * Aggregates every voucher/credit, payment and Stripe receipt belonging to a
 * client, matched strictly to their verified account email (case-insensitive).
 * Combines the direct storefront flow and the group-ordering flow.
 *
 * Receipt URLs are normally captured at webhook time; when a paid record is
 * missing one (older data, or a webhook that raced the Stripe API) we fetch and
 * persist it on demand here.
 */
export async function getDashboardForEmail(
  email: string,
): Promise<DashboardView> {
  const normalized = email.trim().toLowerCase();
  const matches = (col: PgColumn): SQL =>
    eq(sql`lower(${col})`, normalized);

  const vouchers: DashboardVoucher[] = [];
  const payments: DashboardPayment[] = [];

  // ---- Storefront flow ----------------------------------------------------
  const orders = await db
    .select()
    .from(storeOrders)
    .where(matches(storeOrders.buyerEmail));

  for (const order of orders) {
    // Storefront vouchers (issued per order).
    const [voucher] = await db
      .select()
      .from(storeVouchers)
      .where(eq(storeVouchers.orderId, order.id));
    if (voucher) {
      vouchers.push({
        kind: "voucher",
        code: voucher.code,
        source: "storefront",
        status: voucher.status,
        currency: voucher.currency,
        value_minor: Number(voucher.valueMinor),
        expires_at: iso(voucher.expiresAt),
        created_at: iso(voucher.createdAt),
      });
    }

    // First payment (full payment, or instalment #1). Always listed — paid,
    // pending (not yet charged) or expired — so the client sees the full ledger.
    {
      const total = Number(order.totalMinor);
      const firstAmount =
        order.installments <= 1
          ? total
          : Math.round(total / order.installments);
      const firstPaid = order.paidInstalments >= 1;
      let receipt = order.firstReceiptUrl;
      if (firstPaid && !receipt && order.firstPaymentIntentId) {
        receipt = await backfillReceipt(() =>
          fetchPiReceipt(order.firstPaymentIntentId!),
        );
        if (receipt) {
          await db
            .update(storeOrders)
            .set({ firstReceiptUrl: receipt })
            .where(eq(storeOrders.id, order.id));
        }
      }
      payments.push({
        id: `${order.id}:1`,
        source: "storefront",
        description: `${order.productName} — payment 1${
          order.installments > 1 ? ` of ${order.installments}` : ""
        }`,
        amount_minor: firstAmount,
        currency: order.currency,
        status: firstPaid ? "paid" : orderPendingStatus(order.status),
        paid_at: firstPaid ? iso(order.createdAt) : null,
        receipt_url: firstPaid ? (receipt ?? null) : null,
      });
    }

    // Subsequent instalments (2..N) — every scheduled / paid / failed / expired
    // instalment, with its real status preserved.
    if (order.installments > 1) {
      const instalments = await db
        .select()
        .from(storeInstallments)
        .where(eq(storeInstallments.orderId, order.id));
      for (const inst of instalments) {
        const instPaid = inst.status === "paid";
        let receipt = inst.receiptUrl;
        if (instPaid && !receipt && inst.paymentIntentId) {
          receipt = await backfillReceipt(() =>
            fetchPiReceipt(inst.paymentIntentId!),
          );
          if (receipt) {
            await db
              .update(storeInstallments)
              .set({ receiptUrl: receipt })
              .where(eq(storeInstallments.id, inst.id));
          }
        }
        payments.push({
          id: `${order.id}:${inst.number}`,
          source: "storefront",
          description: `${order.productName} — payment ${inst.number} of ${order.installments}`,
          amount_minor: Number(inst.amountMinor),
          currency: order.currency,
          status: instalmentStatus(inst.status),
          paid_at: instPaid ? iso(inst.paidAt) : null,
          receipt_url: instPaid ? (receipt ?? null) : null,
        });
      }
    }
  }

  // ---- Group flow ---------------------------------------------------------
  // Lines the client paid for (payer).
  const paidLines = await db
    .select({
      line: voucherLines,
      orderCurrency: groupOrders.currency,
      orderStatusToken: groupOrders.statusToken,
    })
    .from(voucherLines)
    .innerJoin(groupOrders, eq(voucherLines.groupOrderId, groupOrders.id))
    .where(matches(voucherLines.payerEmail));

  for (const { line, orderCurrency } of paidLines) {
    if (line.voucherCode) {
      vouchers.push({
        kind: "voucher",
        code: line.voucherCode,
        source: "group",
        status: line.status,
        currency: orderCurrency,
        value_minor: Number(line.amountMinor),
        expires_at: null,
        created_at: iso(line.createdAt),
      });
    }
    if (line.creditCode) {
      vouchers.push({
        kind: "credit",
        code: line.creditCode,
        source: "group",
        status: line.status,
        currency: orderCurrency,
        value_minor: Number(line.amountMinor),
        expires_at: null,
        created_at: iso(line.createdAt),
      });
    }
    // Every line the client is responsible for — paid, pending or expired.
    const linePaid = line.status === "paid" || line.paidAt != null;
    let receipt = line.receiptUrl;
    if (linePaid && !receipt && line.stripeSessionId) {
      receipt = await backfillReceipt(() =>
        fetchSessionReceipt(line.stripeSessionId!),
      );
      if (receipt) {
        await db
          .update(voucherLines)
          .set({ receiptUrl: receipt })
          .where(eq(voucherLines.id, line.id));
      }
    }
    payments.push({
      id: line.id,
      source: "group",
      description: `Group voucher — ${line.payerName}`,
      amount_minor: Number(line.amountMinor),
      currency: orderCurrency,
      status: linePaid ? "paid" : line.status,
      paid_at: linePaid ? iso(line.paidAt) : null,
      receipt_url: linePaid ? (receipt ?? null) : null,
    });
  }

  // Organiser-held split voucher (the combined code for a fully-paid split order).
  const organiserOrders = await db
    .select()
    .from(groupOrders)
    .where(matches(groupOrders.organiserEmail));
  for (const order of organiserOrders) {
    if (order.splitVoucherCode) {
      vouchers.push({
        kind: "voucher",
        code: order.splitVoucherCode,
        source: "group",
        status: order.status,
        currency: order.currency,
        value_minor: null,
        expires_at: null,
        created_at: iso(order.createdAt),
      });
    }
  }

  payments.sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
  vouchers.sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  return { email: normalized, vouchers, payments };
}

async function fetchPiReceipt(paymentIntentId: string): Promise<string | null> {
  const stripe = await getUncachableStripeClient();
  return fetchReceiptUrlForPaymentIntent(stripe, paymentIntentId);
}

async function fetchSessionReceipt(sessionId: string): Promise<string | null> {
  const stripe = await getUncachableStripeClient();
  return fetchReceiptUrlForSession(stripe, sessionId);
}

/** Best-effort on-demand receipt fetch; never throws into the request path. */
async function backfillReceipt(
  fetcher: () => Promise<string | null>,
): Promise<string | null> {
  try {
    return await fetcher();
  } catch {
    return null;
  }
}
