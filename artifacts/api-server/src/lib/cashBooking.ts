import crypto from "node:crypto";
import {
  db,
  storeOrders,
  storeVouchers,
  dayPassBookings,
  newOrderNumber,
} from "@workspace/db";
import {
  SETTINGS,
  getDayPass,
  isDatableDayPass,
  paxFor,
  priceFor,
  nameFor,
} from "./storeCatalog";
import {
  DAY_PASS_DAILY_CAPACITY,
  dateClosedReason,
  lockAndCountDate,
} from "./dayPass";
import { normalizePhone } from "./phone";
import { sendIssuedVoucherEmail } from "./voucherEmail";
import { logger } from "./logger";

const newCode = (): string =>
  "SB50-" +
  Array.from({ length: 3 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase(),
  ).join("-");

export interface CashBookingInput {
  product_id: string;
  adults?: number | null;
  children?: number | null;
  /** YYYY-MM-DD. Only used for the per-person passes. */
  visit_date?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Optional negotiated total in minor units; defaults to the catalog price. */
  total_minor?: number | null;
}

export type CashBookingError =
  | "invalid_buyer"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_selection"
  | "invalid_total"
  | "date_required"
  | "invalid_date"
  | "past"
  | "closed_tuesday"
  | "blocked"
  | "full";

export type CashBookingResult =
  | {
      ok: true;
      order_id: string;
      order_number: string | null;
      voucher_code: string;
      total_minor: number;
      currency: string;
      product_name: string;
      pax: number;
      visit_date: string | null;
      emailed: boolean;
    }
  | { error: CashBookingError; remaining?: number };

/**
 * Staff-recorded cash sale of a day pass. Creates a paid order (flagged as cash
 * via the "cash" Stripe placeholders), the day-pass booking that holds calendar
 * capacity, and an active voucher — all atomically. Emails the voucher PDF when
 * the guest has an email address.
 */
export async function createCashBooking(
  input: CashBookingInput,
): Promise<CashBookingResult> {
  const name = input.name?.trim();
  if (!name) return { error: "invalid_buyer" };
  const email = (input.email ?? "").trim();
  if (email && !email.includes("@")) return { error: "invalid_email" };
  let phone: string | null = null;
  if (input.phone && input.phone.trim()) {
    const n = normalizePhone(input.phone, "SC");
    if (!n.ok) return { error: "invalid_phone" };
    phone = n.e164;
  }

  const opt = getDayPass(input.product_id);
  const sel = {
    productId: input.product_id,
    type: "day_pass",
    adults: input.adults ?? undefined,
    children: input.children ?? undefined,
  };
  const catalogTotal = await priceFor(sel);
  const pax = paxFor(sel);
  if (!opt || catalogTotal === null || pax === null) {
    return { error: "invalid_selection" };
  }

  let totalMinor = Math.round(catalogTotal * 100);
  if (input.total_minor != null) {
    if (!Number.isInteger(input.total_minor) || input.total_minor <= 0) {
      return { error: "invalid_total" };
    }
    totalMinor = input.total_minor;
  }

  const datable = isDatableDayPass(input.product_id);
  const visitDate = datable ? (input.visit_date ?? null) : null;
  if (datable && !visitDate) return { error: "date_required" };

  const productName = nameFor(sel);
  const currency = SETTINGS.currency;

  const outcome = await db.transaction(async (tx) => {
    if (visitDate) {
      const reason = await dateClosedReason(tx, visitDate);
      if (reason) {
        return { error: reason === "invalid_date" ? "invalid_date" : reason } as const;
      }
      const used = await lockAndCountDate(tx, visitDate);
      if (used + pax > DAY_PASS_DAILY_CAPACITY) {
        return {
          error: "full",
          remaining: Math.max(0, DAY_PASS_DAILY_CAPACITY - used),
        } as const;
      }
    }

    const [order] = await tx
      .insert(storeOrders)
      .values({
        orderNumber: newOrderNumber(),
        productId: input.product_id,
        productName,
        type: "day_pass",
        buyerName: name,
        buyerEmail: email,
        buyerPhone: phone,
        currency,
        totalMinor,
        installments: 1,
        paidInstalments: 1,
        status: "paid",
        stripeCustomerId: "cash",
        stripePaymentMethodId: "cash",
        dayPassPax: pax,
        dayPassVisitDate: visitDate,
      })
      .returning();

    await tx.insert(dayPassBookings).values({
      orderId: order.id,
      email: email.toLowerCase(),
      productId: input.product_id,
      productName,
      pax,
      visitDate,
      status: "booked",
    });

    const [voucher] = await tx
      .insert(storeVouchers)
      .values({
        orderId: order.id,
        code: newCode(),
        valueMinor: totalMinor,
        currency,
        status: "active",
        expiresAt: new Date(Date.now() + 365 * 864e5),
      })
      .returning();

    return { order, voucher } as const;
  });

  if ("error" in outcome) {
    return outcome as { error: CashBookingError; remaining?: number };
  }

  const { order, voucher } = outcome;
  let emailed = false;
  if (email) {
    try {
      await sendIssuedVoucherEmail({
        to: email,
        recipientName: name,
        code: voucher.code,
      });
      emailed = true;
    } catch (err) {
      logger.error({ err, orderId: order.id }, "Cash booking voucher email failed");
    }
  }

  return {
    ok: true,
    order_id: order.id,
    order_number: order.orderNumber ?? null,
    voucher_code: voucher.code,
    total_minor: totalMinor,
    currency,
    product_name: productName,
    pax,
    visit_date: visitDate,
    emailed,
  };
}
