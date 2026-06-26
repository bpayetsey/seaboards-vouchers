import type { StoreOrder, StoreInstallment } from "@workspace/db";
import { RESORT } from "@workspace/voucher-content";
import { logger } from "./logger";
import { sendEmail, type SendEmailInput } from "./sendgridClient";

/**
 * Absolute base URL of the public app (group-vouchers is served at root "/").
 * Uses the published domain in production and the dev domain otherwise so email
 * links work in both environments. Returns "" when neither is available, in
 * which case CTAs are omitted rather than rendered with a broken link.
 */
function appBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return "";
}

const BRAND = "#1F3A5F";
const GOLD = "#B8860B";

/** Wrap body content in a simple, email-client-safe HTML shell. */
function emailShell(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F8F6F1;font-family:Georgia,'Times New Roman',serif;color:#2A2E35;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:8px;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${GOLD};font-weight:bold;">${RESORT.jubileeTagline}</div>
    </div>
    <div style="background:#ffffff;border:1px solid #E4E0D8;border-radius:16px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:22px;color:${BRAND};">${heading}</h1>
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9aa0a6;font-size:12px;margin-top:24px;">${RESORT.name}</p>
  </div></body></html>`;
}

/** Format a minor-unit amount as a localized currency string. */
function formatMoney(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

/** "Track your vouchers" CTA block, omitted when no base URL is available. */
function dashboardCta(): { html: string; text: string } {
  const base = appBaseUrl();
  if (!base) return { html: "", text: "" };
  const url = `${base}/dashboard`;
  const html = `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #E4E0D8;">
    <p style="margin:0 0 12px;font-size:14px;color:#6B7280;">Create an account (or sign in) to track all your vouchers, payments and receipts in one place.</p>
    <a href="${url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:bold;">Access your dashboard</a>
  </div>`;
  const text = `\n\nTrack all your vouchers, payments and receipts: ${url}`;
  return { html, text };
}

/**
 * Best-effort send for the non-critical instalment / deposit lifecycle emails.
 * The voucher PDF email (issued-voucher path) uses its own throwing sender in
 * `voucherEmail.ts`; here a delivery failure must never break the payment /
 * charge flow, so we swallow and log. Returns whether the send succeeded so
 * callers that guard with an idempotency claim can release it for a retry.
 */
async function sendBestEffort(input: SendEmailInput): Promise<boolean> {
  try {
    await sendEmail(input);
    return true;
  } catch (err) {
    logger.warn({ err, to: input.to }, "Lifecycle email not sent");
    return false;
  }
}

/**
 * Deposit-policy issuance: the Pay-in-3 plan has started but the voucher is not
 * active until fully paid. Confirm receipt and set expectations; no PDF yet —
 * the redeemable voucher PDF is emailed on the final payment (voucherEmail.ts).
 */
export async function sendDepositReceivedEmail(
  order: StoreOrder,
): Promise<boolean> {
  const cta = dashboardCta();
  const html = emailShell(
    "Payment received — your plan has started",
    `<p style="font-size:15px;">Thank you. We've received your first payment for your ${RESORT.offerTitle} and will charge the remaining instalments automatically.</p>
     <p style="font-size:14px;color:#6B7280;">Your voucher activates once your plan is fully paid — we'll email you the voucher PDF then.</p>${cta.html}`,
  );
  const text = `Thank you. We've received your first payment for your ${RESORT.offerTitle} and will charge the remaining instalments automatically.\n\nYour voucher activates once your plan is fully paid — we'll email you the voucher PDF then.${cta.text}`;
  return sendBestEffort({
    to: order.buyerEmail,
    subject: `Payment received — ${RESORT.offerTitle}`,
    html,
    text,
  });
}

/**
 * Per-instalment payment receipt for an upcoming "Pay in 3" instalment that has
 * just been collected — sent whether the instalment was finalised by the daily
 * charge job (via the webhook) or by a client paying it early from their
 * dashboard, so the experience is consistent and the buyer always has a record.
 * The redeemable voucher PDF is still emailed separately on the final payment
 * (voucherEmail.ts); this is just the payment confirmation for an intermediate
 * instalment. Best-effort: returns whether delivery succeeded so the caller can
 * release its idempotency claim for a retry.
 */
export async function sendInstalmentReceiptEmail(
  order: StoreOrder,
  inst: StoreInstallment,
  receiptUrl: string | null,
): Promise<boolean> {
  const cta = dashboardCta();
  const amount = formatMoney(Number(inst.amountMinor), order.currency);
  const receiptHtml = receiptUrl
    ? `<p style="margin:16px 0 0;font-size:14px;"><a href="${receiptUrl}" style="color:${BRAND};font-weight:bold;text-decoration:none;">View your payment receipt</a></p>`
    : "";
  const receiptText = receiptUrl
    ? `\n\nView your payment receipt: ${receiptUrl}`
    : "";
  const html = emailShell(
    "Payment received",
    `<p style="font-size:15px;">Thank you. We've received instalment ${inst.number} of ${order.installments} (${amount}) for your ${RESORT.offerTitle} payment plan.</p>
     <p style="font-size:14px;color:#6B7280;">Your remaining instalments will continue to be charged automatically. Your voucher activates once your plan is fully paid — we'll email you the voucher PDF then.</p>${receiptHtml}${cta.html}`,
  );
  const text = `Thank you. We've received instalment ${inst.number} of ${order.installments} (${amount}) for your ${RESORT.offerTitle} payment plan.\n\nYour remaining instalments will continue to be charged automatically. Your voucher activates once your plan is fully paid — we'll email you the voucher PDF then.${receiptText}${cta.text}`;
  return sendBestEffort({
    to: order.buyerEmail,
    subject: `Payment received — instalment ${inst.number} of ${order.installments} — ${RESORT.offerTitle}`,
    html,
    text,
  });
}

export async function sendActionRequiredEmail(
  order: StoreOrder,
  inst: StoreInstallment,
): Promise<void> {
  const cta = dashboardCta();
  const html = emailShell(
    "Action needed for your payment",
    `<p style="font-size:15px;">Your bank needs to confirm instalment ${inst.number} of your ${RESORT.offerTitle} payment plan.</p>
     <p style="font-size:14px;color:#6B7280;">Please complete the verification so we can process your payment. If you've already done this, you can ignore this message.</p>${cta.html}`,
  );
  const text = `Your bank needs to confirm instalment ${inst.number} of your ${RESORT.offerTitle} payment plan. Please complete the verification so we can process your payment.${cta.text}`;
  await sendBestEffort({
    to: order.buyerEmail,
    subject: `Action needed — ${RESORT.offerTitle} payment`,
    html,
    text,
  });
}

export async function sendPaymentFailedEmail(
  order: StoreOrder,
  inst: StoreInstallment,
): Promise<void> {
  const cta = dashboardCta();
  const html = emailShell(
    "We couldn't process your payment",
    `<p style="font-size:15px;">Instalment ${inst.number} of your ${RESORT.offerTitle} payment plan didn't go through.</p>
     <p style="font-size:14px;color:#6B7280;">We'll try again automatically. To avoid delays, please check that your card details are up to date.</p>${cta.html}`,
  );
  const text = `Instalment ${inst.number} of your ${RESORT.offerTitle} payment plan didn't go through. We'll try again automatically. Please check that your card details are up to date.${cta.text}`;
  await sendBestEffort({
    to: order.buyerEmail,
    subject: `Payment issue — ${RESORT.offerTitle}`,
    html,
    text,
  });
}
