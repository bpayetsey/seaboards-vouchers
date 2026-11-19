/**
 * Chat orders: vouchers and day passes sold from the WhatsApp assistant.
 *
 * The storefront's own checkout embeds Stripe's Payment Element in the page, which
 * a chat cannot do, so a chat order pays on a hosted Stripe Checkout page instead:
 * the assistant collects the choice and the buyer's details, calls
 * createChatOrder, and sends the returned pay_url to the guest. Everything after
 * payment is the normal storefront pipeline (processPaidIntent): the order is
 * marked paid, a day-pass booking takes its calendar slot, the voucher PDF is
 * emailed and the WhatsApp confirmation template goes out.
 *
 * Payment is always in full (one instalment); the "Pay in 3" plan stays on the
 * website. The caller polls confirmChatOrder until the order is paid or expired;
 * the Stripe webhook (payment_intent.succeeded) also settles it when wired.
 */
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, storeOrders, storeVouchers, newOrderNumber } from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient";
import { SETTINGS, SYMBOLS, priceFor, nameFor, paxFor, isDatableDayPass } from "./storeCatalog";
import { getAvailability } from "./dayPass";
import { processPaidIntent } from "./storefront";
import { normalizePhone } from "./phone";
import { logger } from "./logger";

const CUR = SETTINGS.currency;
const toMinor = (major: number): number => Math.round(Number(major) * 100);
const MIN_TTL_MS = 30 * 60_000; // Stripe's minimum Checkout expiry
const MAX_TTL_MS = 24 * 3600_000 - 60_000; // and its maximum

/** Adds the checkout_session_id column on first boot (idempotent). */
export async function ensureChatOrderSchema(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE store_order ADD COLUMN IF NOT EXISTS checkout_session_id text`,
  );
}

export function publicBaseUrl(): string {
  const explicit = process.env.STORE_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return domain ? `https://${domain}` : "";
}

export interface ChatOrderInput {
  type: "package" | "day_pass";
  product_id: string;
  nights?: number;
  adults?: number;
  children?: number;
  extension?: boolean;
  visit_date?: string | null;
  name: string;
  email: string;
  phone: string;
  /** How long the pay link stays open, in hours (clamped to Stripe's 0.5-24h). */
  hold_hours?: number;
  /** Free text shown on the Stripe page, e.g. "WhatsApp +248 2 580 933". */
  reference?: string;
}

export type ChatOrderError =
  | "invalid_buyer"
  | "invalid_phone"
  | "invalid_selection"
  | "date_unavailable"
  | "payments_unavailable";

export interface ChatOrderCreated {
  order_id: string;
  order_number: string | null;
  product_name: string;
  total: number;
  currency: string;
  symbol: string;
  pay_url: string;
  expires_at: string;
  visit_date: string | null;
  pax: number | null;
}

export async function createChatOrder(
  input: ChatOrderInput,
): Promise<ChatOrderCreated | { error: ChatOrderError; detail?: string }> {
  const { type, product_id, nights, adults, children, extension, visit_date, name, email, phone } = input;
  if (!name?.trim() || !email?.includes("@")) return { error: "invalid_buyer" };
  const normalizedPhone = normalizePhone(phone ?? "", "SC");
  if (!normalizedPhone.ok) return { error: "invalid_phone" };
  if (type !== "package" && type !== "day_pass") return { error: "invalid_selection", detail: "type must be package or day_pass" };

  const total = await priceFor({ productId: product_id, type, nights, adults, children, extension });
  if (total === null) return { error: "invalid_selection", detail: "unknown product, or nights/adults/children outside what it allows" };
  const productName = nameFor({ productId: product_id, type, nights, adults, children, extension });
  const pax = type === "day_pass" ? paxFor({ productId: product_id, type, adults, children }) : null;
  if (type === "day_pass" && pax === null) return { error: "invalid_selection" };

  let visitDate: string | null = null;
  if (visit_date && isDatableDayPass(product_id)) {
    const [day] = await getAvailability(visit_date, visit_date, pax ?? 1);
    if (!day || !day.bookable) return { error: "date_unavailable" };
    visitDate = visit_date;
  }

  let stripe: Stripe;
  try {
    stripe = await getUncachableStripeClient();
  } catch {
    return { error: "payments_unavailable" };
  }

  const customer = await stripe.customers.create({
    email,
    name,
    phone: normalizedPhone.e164,
    metadata: { campaign: "sb50", source: "whatsapp" },
  });

  const [order] = await db
    .insert(storeOrders)
    .values({
      orderNumber: newOrderNumber(),
      productId: product_id,
      productName,
      type,
      buyerName: name.trim(),
      buyerEmail: email.trim(),
      buyerPhone: normalizedPhone.e164,
      currency: CUR,
      totalMinor: toMinor(total),
      creditAppliedMinor: 0,
      dayPassPax: pax,
      dayPassVisitDate: visitDate,
      installments: 1,
      stripeCustomerId: customer.id,
      status: "pending",
    })
    .returning();

  const ttl = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, (Number(input.hold_hours) || 23) * 3600_000));
  const expiresAt = Math.floor((Date.now() + ttl) / 1000);
  const base = publicBaseUrl();
  const description = [productName, visitDate ? `visit ${visitDate}` : null, input.reference?.trim() || null].filter(Boolean).join(" · ");

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: customer.id,
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CUR,
              unit_amount: toMinor(total),
              product_data: { name: productName, description: description.slice(0, 500) },
            },
          },
        ],
        payment_intent_data: {
          description: description.slice(0, 1000),
          metadata: { orderId: order.id, instalmentNo: "1", instalments: "1", source: "whatsapp" },
        },
        metadata: { orderId: order.id, source: "whatsapp" },
        expires_at: expiresAt,
        success_url: `${base}/api/chat/orders/${order.id}/done?cs={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/`,
      },
      { idempotencyKey: `chat-order-${order.id}` },
    );
  } catch (err) {
    await db
      .update(storeOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(storeOrders.id, order.id));
    throw err;
  }
  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  await db
    .update(storeOrders)
    .set({ checkoutSessionId: session.id, firstPaymentIntentId: paymentIntentId, updatedAt: new Date() })
    .where(eq(storeOrders.id, order.id));

  logger.info({ orderId: order.id, orderNumber: order.orderNumber, total, productName }, "Chat order created");
  return {
    order_id: order.id,
    order_number: order.orderNumber,
    product_name: productName,
    total,
    currency: CUR.toUpperCase(),
    symbol: SYMBOLS[CUR] ?? `${CUR.toUpperCase()} `,
    pay_url: session.url,
    expires_at: new Date(expiresAt * 1000).toISOString(),
    visit_date: visitDate,
    pax,
  };
}

export interface ChatOrderStatus {
  order_id: string;
  order_number: string | null;
  product_name: string;
  total: number;
  currency: string;
  /** pending | paid | expired | cancelled */
  status: string;
  buyer_name: string;
  buyer_email: string;
  visit_date: string | null;
  voucher: { code: string; status: string; pdf_url: string } | null;
  pay_url: string | null;
}

/**
 * Settles a chat order from its Checkout session: a paid session is processed
 * through the storefront pipeline (idempotent), an expired one closes the order.
 */
export async function confirmChatOrder(orderId: string): Promise<ChatOrderStatus | null> {
  const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, orderId));
  if (!order || !order.checkoutSessionId) return null;

  let payUrl: string | null = null;
  if (order.status === "pending") {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(order.checkoutSessionId);
    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
    if (session.payment_status === "paid" && piId) {
      if (order.firstPaymentIntentId !== piId) {
        await db.update(storeOrders).set({ firstPaymentIntentId: piId, updatedAt: new Date() }).where(eq(storeOrders.id, order.id));
      }
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge", "payment_method"] });
      if (pi.status === "succeeded") await processPaidIntent(pi);
    } else if (session.status === "expired") {
      await db.update(storeOrders).set({ status: "expired", updatedAt: new Date() }).where(eq(storeOrders.id, order.id));
    } else if (session.status === "open") {
      payUrl = session.url ?? null;
    }
  }
  return statusOf(orderId, payUrl);
}

/** Closes an unpaid chat order and expires its Stripe page (no-op once paid). */
export async function cancelChatOrder(orderId: string): Promise<ChatOrderStatus | null> {
  const [order] = await db.select().from(storeOrders).where(eq(storeOrders.id, orderId));
  if (!order || !order.checkoutSessionId) return null;
  if (order.status === "pending") {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(order.checkoutSessionId);
    if (session.payment_status === "paid") return confirmChatOrder(orderId);
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    await db.update(storeOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(storeOrders.id, order.id));
  }
  return statusOf(orderId, null);
}

async function statusOf(orderId: string, payUrl: string | null): Promise<ChatOrderStatus | null> {
  const [fresh] = await db.select().from(storeOrders).where(eq(storeOrders.id, orderId));
  if (!fresh) return null;
  const [voucher] = await db.select().from(storeVouchers).where(eq(storeVouchers.orderId, fresh.id));
  return {
    order_id: fresh.id,
    order_number: fresh.orderNumber,
    product_name: fresh.productName,
    total: Number(fresh.totalMinor) / 100,
    currency: fresh.currency.toUpperCase(),
    status: fresh.status,
    buyer_name: fresh.buyerName,
    buyer_email: fresh.buyerEmail,
    visit_date: fresh.dayPassVisitDate ?? null,
    voucher: voucher ? { code: voucher.code, status: voucher.status, pdf_url: `${publicBaseUrl()}/api/vouchers/${encodeURIComponent(voucher.code)}/pdf` } : null,
    pay_url: payUrl,
  };
}

const esc = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page Stripe returns the buyer to after paying a chat order. */
export function renderDonePage(status: ChatOrderStatus | null): string {
  const base = publicBaseUrl();
  const money = (n: number, cur: string) => `${SYMBOLS[cur.toLowerCase()] ?? `${cur} `}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let title: string;
  let body: string;
  if (!status) {
    title = "Order not found";
    body = "<p>We could not find this order. If you have paid, your voucher will still reach you by email and WhatsApp.</p>";
  } else if (status.status === "paid" && status.voucher) {
    title = "Payment received";
    body = `<p>Thank you, ${esc(status.buyer_name)}. Your <strong>${esc(status.product_name)}</strong> (${esc(money(status.total, status.currency))}) is confirmed${status.visit_date ? ` for <strong>${esc(status.visit_date)}</strong>` : ""}.</p>
<p>Voucher code <strong class="code">${esc(status.voucher.code)}</strong>. The voucher PDF is on its way to ${esc(status.buyer_email)} and a WhatsApp confirmation follows.</p>
<p><a class="btn" href="${esc(status.voucher.pdf_url)}">Download the voucher (PDF)</a></p>`;
  } else if (status.status === "paid") {
    title = "Payment received";
    body = `<p>Thank you, ${esc(status.buyer_name)}. Your payment for <strong>${esc(status.product_name)}</strong> is in and your voucher is being issued; it reaches ${esc(status.buyer_email)} within a few minutes.</p>`;
  } else if (status.status === "pending") {
    title = "Almost there";
    body = `<p>We are waiting for your payment to be confirmed. This page refreshes itself; your WhatsApp chat is also told as soon as it is done.</p>${status.pay_url ? `<p><a class="btn" href="${esc(status.pay_url)}">Return to the payment page</a></p>` : ""}`;
  } else {
    title = "This payment link has closed";
    body = "<p>The order was not paid in time. Message us on WhatsApp and we will prepare a new one.</p>";
  }
  const refresh = status?.status === "pending" ? '<meta http-equiv="refresh" content="5">' : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${esc(title)} · The Seaboards</title>
<style>body{margin:0;font-family:Georgia,serif;background:#f7f4ee;color:#1f2a44}main{max-width:560px;margin:0 auto;padding:48px 24px}h1{font-weight:normal;font-size:28px;margin:0 0 16px}p{line-height:1.5;font-size:17px}.code{font-family:ui-monospace,monospace;letter-spacing:.06em}.btn{display:inline-block;margin-top:8px;padding:12px 20px;background:#1f2a44;color:#fff;text-decoration:none;border-radius:6px;font-family:system-ui,sans-serif;font-size:15px}.eyebrow{font-family:system-ui,sans-serif;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#8a7a4e;margin-bottom:24px}footer{margin-top:40px;font-family:system-ui,sans-serif;font-size:13px;color:#6b6b6b}</style></head>
<body><main><div class="eyebrow">The Seaboards Apartments · Anse La Mouche · Mahe</div><h1>${esc(title)}</h1>${body}<footer><a href="${esc(base || "/")}" style="color:#6b6b6b">voucher.theseaboards.com</a></footer></main></body></html>`;
}
