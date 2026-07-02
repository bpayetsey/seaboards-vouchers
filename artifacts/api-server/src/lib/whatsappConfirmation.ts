import { eq } from "drizzle-orm";
import {
  db,
  storeOrders,
  storeVouchers,
  voucherLines,
  groupOrders,
} from "@workspace/db";
import { logger } from "./logger";
import { getWhatsappConfirmationTemplate } from "./siteContent";
import {
  isWhatsappConfigured,
  fetchApprovedTemplates,
  sendTemplateMessage,
} from "./whatsappClient";
import { resolveVoucherByCode } from "./voucherPdf";

const formatDate = (d: Date): string =>
  d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * Best-effort WhatsApp voucher confirmation, sent alongside the email at every
 * voucher-issue point. Business-initiated WhatsApp messages MUST use a
 * Meta-approved template, so this only sends when staff have selected one in
 * Site content; otherwise it logs and skips. NEVER throws and is never awaited
 * on the critical path — a WhatsApp failure must not affect voucher issuance
 * or the email send.
 *
 * Positional template variables are filled best-effort in the order
 * [recipient name, voucher code, validity], padded/truncated to the template's
 * declared variable count. Templates requiring header media are skipped (we
 * have no media to attach).
 */
export async function sendVoucherWhatsappConfirmation(input: {
  phone: string | null | undefined;
  recipientName: string | null | undefined;
  code: string;
}): Promise<void> {
  const { phone, recipientName, code } = input;
  try {
    if (!phone) {
      logger.info({ code }, "WhatsApp confirmation skipped: no phone on file");
      return;
    }
    if (!isWhatsappConfigured()) {
      logger.info(
        { code },
        "WhatsApp confirmation skipped: sender not configured",
      );
      return;
    }
    const templateName = await getWhatsappConfirmationTemplate();
    if (!templateName) {
      logger.info(
        { code },
        "WhatsApp confirmation skipped: no template selected in site content",
      );
      return;
    }
    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) {
      logger.warn(
        { code, templateName },
        "WhatsApp confirmation skipped: selected template is no longer approved",
      );
      return;
    }
    if (template.headerFormat !== "NONE" && template.headerFormat !== "TEXT") {
      logger.warn(
        { code, templateName, headerFormat: template.headerFormat },
        "WhatsApp confirmation skipped: template requires header media",
      );
      return;
    }

    // Validity string, best-effort from the issued voucher record.
    let validity = "See your voucher PDF for validity";
    try {
      const voucher = await resolveVoucherByCode(code);
      if (voucher?.expiresAt) {
        validity = `Valid until ${formatDate(new Date(voucher.expiresAt))}`;
      }
    } catch {
      // keep the fallback text
    }

    const base = [recipientName?.trim() || "Guest", code, validity];
    const variables = Array.from(
      { length: template.variableCount },
      (_, i) => base[i] ?? code,
    );

    const result = await sendTemplateMessage({
      to: phone,
      templateName: template.name,
      languageCode: template.language,
      variables,
    });
    if (result.ok) {
      logger.info(
        { code, to: phone, templateName, messageId: result.messageId },
        "WhatsApp voucher confirmation sent",
      );
    } else {
      logger.warn(
        { code, to: phone, templateName, error: result.error },
        "WhatsApp voucher confirmation failed (voucher email unaffected)",
      );
    }
  } catch (err) {
    logger.warn(
      { err, code },
      "WhatsApp voucher confirmation errored (voucher email unaffected)",
    );
  }
}

/**
 * Find the stored mobile number for an issued voucher code, checking the three
 * places a code is minted: storefront vouchers (buyer phone), group
 * per-participant lines (payer phone) and released split master vouchers
 * (organiser phone). Used by the dashboard resend flow. Never throws.
 */
export async function findPhoneForVoucherCode(
  code: string,
): Promise<string | null> {
  try {
    const [storeVoucher] = await db
      .select()
      .from(storeVouchers)
      .where(eq(storeVouchers.code, code));
    if (storeVoucher?.orderId) {
      const [order] = await db
        .select()
        .from(storeOrders)
        .where(eq(storeOrders.id, storeVoucher.orderId));
      return order?.buyerPhone ?? null;
    }
    if (storeVoucher) return null;

    const [line] = await db
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.voucherCode, code));
    if (line) return line.payerPhone ?? null;

    const [order] = await db
      .select()
      .from(groupOrders)
      .where(eq(groupOrders.splitVoucherCode, code));
    if (order) return order.organiserPhone ?? null;

    return null;
  } catch (err) {
    logger.warn({ err, code }, "Failed to look up phone for voucher code");
    return null;
  }
}
