import type { StoreOrder, StoreInstallment, StoreVoucher } from "@workspace/db";
import { RESORT } from "@workspace/voucher-content";
import { logger } from "./logger";
import { SYMBOLS } from "./storeCatalog";
import { sendEmail, type EmailAttachment } from "./sendgridClient";
import { resolveVoucherByCode, buildVoucherPdf } from "./voucherPdf";

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

function formatMoney(valueMinor: number, currency: string): string {
  const symbol = SYMBOLS[currency.toLowerCase()] ?? `${currency.toUpperCase()} `;
  const major = (valueMinor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol}${major}`;
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

/** Best-effort build of the voucher PDF attachment. Null on any failure. */
async function buildVoucherAttachment(
  code: string,
): Promise<EmailAttachment | null> {
  try {
    const resolved = await resolveVoucherByCode(code);
    if (!resolved) return null;
    const bytes = await buildVoucherPdf(resolved);
    return {
      filename: `seaboards-voucher-${code}.pdf`,
      content: bytes,
      type: "application/pdf",
    };
  } catch (err) {
    logger.warn({ err, code }, "Could not build voucher PDF for email");
    return null;
  }
}

export async function sendVoucherEmail(
  order: StoreOrder,
  voucher: StoreVoucher,
  fullyPaid: boolean,
): Promise<boolean> {
  const cta = dashboardCta();
  const value = formatMoney(Number(voucher.valueMinor), voucher.currency);

  if (fullyPaid) {
    const attachment = await buildVoucherAttachment(voucher.code);
    const codeBlock = `<div style="margin:20px 0;text-align:center;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6B7280;">Your voucher code</div>
      <div style="font-family:'Courier New',monospace;font-size:24px;font-weight:bold;color:${BRAND};margin-top:6px;">${voucher.code}</div>
      <div style="font-size:14px;color:#6B7280;margin-top:6px;">Value: ${value}</div>
    </div>`;
    const note = attachment
      ? `<p style="font-size:14px;color:#6B7280;">Your voucher is attached as a PDF. Keep it safe — you'll need the code when booking.</p>`
      : `<p style="font-size:14px;color:#6B7280;">Keep this code safe — you'll need it when booking.</p>`;
    const html = emailShell(
      "Your voucher is ready",
      `<p style="font-size:15px;">Thank you for your purchase. Your ${RESORT.offerTitle} is now active.</p>${codeBlock}${note}${cta.html}`,
    );
    const text = `Your ${RESORT.offerTitle} is ready.\n\nVoucher code: ${voucher.code}\nValue: ${value}\n\nKeep this code safe — you'll need it when booking.${cta.text}`;
    return sendEmail({
      to: order.buyerEmail,
      subject: `Your ${RESORT.offerTitle} is ready`,
      html,
      text,
      attachments: attachment ? [attachment] : undefined,
    });
  }

  // Deposit-policy issuance: the plan has started but the voucher is not active
  // until fully paid. Confirm receipt and set expectations; no PDF yet.
  const html = emailShell(
    "Payment received — your plan has started",
    `<p style="font-size:15px;">Thank you. We've received your first payment for your ${RESORT.offerTitle} and will charge the remaining instalments automatically.</p>
     <p style="font-size:14px;color:#6B7280;">Your voucher activates once your plan is fully paid — we'll email you the voucher PDF then.</p>${cta.html}`,
  );
  const text = `Thank you. We've received your first payment for your ${RESORT.offerTitle} and will charge the remaining instalments automatically.\n\nYour voucher activates once your plan is fully paid — we'll email you the voucher PDF then.${cta.text}`;
  return sendEmail({
    to: order.buyerEmail,
    subject: `Payment received — ${RESORT.offerTitle}`,
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
  await sendEmail({
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
  await sendEmail({
    to: order.buyerEmail,
    subject: `Payment issue — ${RESORT.offerTitle}`,
    html,
    text,
  });
}
