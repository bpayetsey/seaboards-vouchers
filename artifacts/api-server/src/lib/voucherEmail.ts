import { RESORT, REDEMPTION_WINDOW } from "@workspace/voucher-content";
import { resolveVoucherByCode, buildVoucherPdf } from "./voucherPdf";
import { sendEmail } from "./sendgridClient";
import { logger } from "./logger";

/**
 * Resolve the app's public base URL for building the voucher download link.
 * Prefers the explicit STORE_BASE_URL deployment secret, falls back to the
 * first Replit domain. Returns null when neither is available so the email can
 * still go out with the attached PDF (just without a clickable link).
 */
function publicBaseUrl(): string | null {
  const explicit = process.env.STORE_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return domain ? `https://${domain}` : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface SendIssuedVoucherEmailInput {
  to: string;
  recipientName?: string | null;
  code: string;
}

/**
 * Build the voucher PDF for `code` and email it to the buyer as an attachment,
 * along with a secure download link (the code is an unguessable capability
 * token, so the link needs no extra auth). Throws on any failure so callers can
 * release their idempotency claim and let a later webhook retry resend.
 */
export async function sendIssuedVoucherEmail({
  to,
  recipientName,
  code,
}: SendIssuedVoucherEmailInput): Promise<void> {
  const voucher = await resolveVoucherByCode(code);
  if (!voucher) {
    throw new Error(`Cannot email voucher: code not found (${code})`);
  }

  const pdf = await buildVoucherPdf(voucher);
  const pdfBase64 = Buffer.from(pdf).toString("base64");
  const safeCode = code.replace(/[^A-Za-z0-9-]/g, "");

  const base = publicBaseUrl();
  const downloadUrl = base ? `${base}/api/vouchers/${encodeURIComponent(code)}/pdf` : null;
  const greetingName = recipientName?.trim() || "there";
  const validity = voucher.expiresAt
    ? `valid until ${voucher.expiresAt.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`
    : REDEMPTION_WINDOW;

  const subject = `Your ${RESORT.name} voucher (${code})`;

  const text = [
    `Hello ${greetingName},`,
    "",
    `Thank you — your ${RESORT.offerTitle} voucher has been issued.`,
    "",
    `Voucher code: ${code}`,
    `Validity: ${validity}`,
    "",
    "Your voucher is attached to this email as a PDF.",
    downloadUrl ? `You can also download it any time here: ${downloadUrl}` : "",
    "",
    `We look forward to welcoming you to ${RESORT.name}.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; color: #21211f; max-width: 560px; margin: 0 auto;">
      <p style="font-size: 11px; letter-spacing: 2px; color: #B8860B; text-transform: uppercase; margin: 0 0 4px;">
        ${escapeHtml(RESORT.jubileeTagline)}
      </p>
      <h1 style="font-size: 22px; color: #1F3A5F; margin: 0 0 16px;">${escapeHtml(RESORT.name)}</h1>
      <p>Hello ${escapeHtml(greetingName)},</p>
      <p>Thank you — your <strong>${escapeHtml(RESORT.offerTitle)}</strong> voucher has been issued.</p>
      <div style="background:#F8F6F1; border:1.5px solid #B8860B; border-radius:6px; padding:18px; text-align:center; margin:20px 0;">
        <div style="font-size:11px; letter-spacing:2px; color:#6b6b6b; text-transform:uppercase;">Voucher code</div>
        <div style="font-size:24px; font-weight:bold; color:#1F3A5F; margin:6px 0;">${escapeHtml(code)}</div>
        <div style="font-size:13px; color:#21211f;">${escapeHtml(validity)}</div>
      </div>
      <p>Your voucher is attached to this email as a PDF.${
        downloadUrl
          ? ` You can also <a href="${escapeHtml(downloadUrl)}" style="color:#B8860B;">download it any time</a>.`
          : ""
      }</p>
      <p style="color:#6b6b6b;">We look forward to welcoming you to ${escapeHtml(RESORT.name)}.</p>
    </div>
  `;

  await sendEmail({
    to,
    subject,
    text,
    html,
    attachments: [
      {
        content: pdfBase64,
        filename: `Seaboards-Voucher-${safeCode}.pdf`,
        type: "application/pdf",
      },
    ],
  });

  logger.info({ to, code }, "Voucher PDF emailed to buyer");
}
