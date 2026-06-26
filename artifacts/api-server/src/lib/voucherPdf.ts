import { eq } from "drizzle-orm";
import {
  db,
  storeVouchers,
  storeOrders,
  voucherLines,
  groupOrders,
} from "@workspace/db";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  RESORT,
  VOUCHER_TERMS,
  TERMS_ACCEPTANCE,
  REDEMPTION_WINDOW,
} from "@workspace/voucher-content";

/**
 * A voucher resolved by its code, with everything needed to render the PDF plus
 * the set of account emails permitted to download it (used to owner-scope the
 * authenticated dashboard route). `valueMinor` is null for combined split
 * "master" vouchers where no single per-person amount applies.
 */
export interface ResolvedVoucher {
  code: string;
  valueMinor: number | null;
  currency: string;
  expiresAt: Date | null;
  /** Lower-cased emails allowed to download this voucher from the dashboard. */
  authorizedEmails: string[];
}

const lower = (email: string): string => email.trim().toLowerCase();

/**
 * Look up an *issued* voucher by its code across the three sources that mint a
 * redeemable code: storefront vouchers, group per-participant voucher lines, and
 * released split "master" vouchers. Store-credit codes, pending split shares and
 * not-yet-released master vouchers are intentionally excluded.
 */
export async function resolveVoucherByCode(
  code: string,
): Promise<ResolvedVoucher | null> {
  // 1. Storefront voucher (direct-to-buyer). Owner = the order's buyer.
  const [storeVoucher] = await db
    .select()
    .from(storeVouchers)
    .where(eq(storeVouchers.code, code));
  if (storeVoucher) {
    const authorizedEmails: string[] = [];
    if (storeVoucher.orderId) {
      const [order] = await db
        .select()
        .from(storeOrders)
        .where(eq(storeOrders.id, storeVoucher.orderId));
      if (order) authorizedEmails.push(lower(order.buyerEmail));
    }
    return {
      code: storeVoucher.code,
      valueMinor: storeVoucher.valueMinor,
      currency: storeVoucher.currency,
      expiresAt: storeVoucher.expiresAt,
      authorizedEmails,
    };
  }

  // 2. Group per-participant voucher line (independent / flat / split share).
  //    Owner = the participant who paid, plus the organiser.
  const [line] = await db
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.voucherCode, code));
  if (line) {
    const [order] = await db
      .select()
      .from(groupOrders)
      .where(eq(groupOrders.id, line.groupOrderId));
    const authorizedEmails = [lower(line.payerEmail)];
    if (order) authorizedEmails.push(lower(order.organiserEmail));
    return {
      code,
      valueMinor: line.amountMinor,
      currency: order?.currency ?? "SCR",
      expiresAt: null,
      authorizedEmails,
    };
  }

  // 3. Released split "master" voucher. Only available once the group order is
  //    complete (every share paid). Owner = organiser + all paid split payers.
  const [order] = await db
    .select()
    .from(groupOrders)
    .where(eq(groupOrders.splitVoucherCode, code));
  if (order && order.status === "complete") {
    const lines = await db
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.groupOrderId, order.id));
    const authorizedEmails = [lower(order.organiserEmail)];
    for (const l of lines) {
      if (l.status === "paid") authorizedEmails.push(lower(l.payerEmail));
    }
    return {
      code,
      valueMinor: null,
      currency: order.currency,
      expiresAt: null,
      authorizedEmails,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

const NAVY = rgb(0.122, 0.227, 0.373); // #1F3A5F
const GOLD = rgb(0.722, 0.525, 0.043); // #B8860B
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.42, 0.46);
const CREAM = rgb(0.98, 0.96, 0.91);

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

function formatMoney(valueMinor: number, currency: string): string {
  const major = valueMinor / 100;
  const formatted = major.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${currency.toUpperCase()} ${formatted}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Greedy word-wrap into lines that fit `maxWidth` at the given font/size. */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Build a one-page A4 voucher PDF. Returns the encoded PDF bytes. */
export async function buildVoucherPdf(
  voucher: ResolvedVoucher,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RESORT.offerTitle} \u2013 ${voucher.code}`);
  pdf.setAuthor(RESORT.name);

  const page = pdf.addPage([A4.width, A4.height]);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let y = A4.height - MARGIN;

  const drawCentered = (
    text: string,
    font: PDFFont,
    size: number,
    color = INK,
  ) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (A4.width - w) / 2,
      y,
      size,
      font,
      color,
    });
  };

  // --- Header band -------------------------------------------------------
  y -= 6;
  drawCentered(RESORT.jubileeTagline.toUpperCase(), helvBold, 9, GOLD);
  y -= 26;
  drawCentered(RESORT.name, helvBold, 22, NAVY);
  y -= 15;
  drawCentered(RESORT.location, helv, 10, MUTED);
  y -= 26;
  drawCentered(RESORT.offerTitle, helvOblique, 13, INK);

  // --- Voucher code panel ------------------------------------------------
  y -= 24;
  const panelHeight = 96;
  const panelTop = y;
  page.drawRectangle({
    x: MARGIN,
    y: panelTop - panelHeight,
    width: CONTENT_WIDTH,
    height: panelHeight,
    color: CREAM,
    borderColor: GOLD,
    borderWidth: 1.5,
  });

  y = panelTop - 22;
  drawCentered("VOUCHER CODE", helvBold, 9, MUTED);
  y -= 30;
  drawCentered(voucher.code, helvBold, 26, NAVY);

  y -= 26;
  const valueText =
    voucher.valueMinor != null
      ? `Value: ${formatMoney(voucher.valueMinor, voucher.currency)}`
      : "Combined group stay voucher";
  const validityText = voucher.expiresAt
    ? `Valid until ${formatDate(voucher.expiresAt)}`
    : REDEMPTION_WINDOW;
  drawCentered(`${valueText}    \u00b7    ${validityText}`, helv, 10, INK);

  y = panelTop - panelHeight - 28;

  // --- Terms & Conditions ------------------------------------------------
  page.drawText("Terms & Conditions", {
    x: MARGIN,
    y,
    size: 13,
    font: helvBold,
    color: NAVY,
  });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: GOLD,
  });
  y -= 16;

  const titleSize = 9.5;
  const clauseSize = 8.5;
  const lineGap = 2.5;

  for (const section of VOUCHER_TERMS) {
    page.drawText(section.title, {
      x: MARGIN,
      y,
      size: titleSize,
      font: helvBold,
      color: INK,
    });
    y -= titleSize + 4;

    for (const clause of section.clauses) {
      const lines = wrapText(clause, helv, clauseSize, CONTENT_WIDTH - 10);
      for (const line of lines) {
        page.drawText(line, {
          x: MARGIN + 10,
          y,
          size: clauseSize,
          font: helv,
          color: MUTED,
        });
        y -= clauseSize + lineGap;
      }
      y -= 1.5;
    }
    y -= 4;
  }

  // --- Footer ------------------------------------------------------------
  drawFooter(page, helvOblique);

  return pdf.save();
}

function drawFooter(page: PDFPage, font: PDFFont): void {
  const accLines = wrapText(TERMS_ACCEPTANCE, font, 7.5, CONTENT_WIDTH);
  let fy = MARGIN + 4 + accLines.length * 10;
  for (const line of accLines) {
    const w = font.widthOfTextAtSize(line, 7.5);
    page.drawText(line, {
      x: (A4.width - w) / 2,
      y: fy,
      size: 7.5,
      font,
      color: MUTED,
    });
    fy -= 10;
  }
}
