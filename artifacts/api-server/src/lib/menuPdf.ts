import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import {
  RESORT,
  MENU_TITLE,
  MENU_EPIGRAPH,
  MENU_INTRO,
  DINNER_SECTIONS,
  DESSERT_NOTE,
  BREAKFAST_STYLES,
} from "@workspace/voucher-content";

// Shares the branding conventions of the voucher PDF (see voucherPdf.ts).
const NAVY = rgb(0.122, 0.227, 0.373); // #1F3A5F
const GOLD = rgb(0.722, 0.525, 0.043); // #B8860B
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.42, 0.46);

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 54;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const BOTTOM = MARGIN + 24; // keep clear of the per-page footer line

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

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
}

/**
 * A cursor that draws top-to-bottom across pages, adding a new page (with the
 * shared footer) whenever the next block would not fit above the bottom margin.
 */
class PageCursor {
  page: PDFPage;
  y: number;

  constructor(
    private pdf: PDFDocument,
    private fonts: Fonts,
  ) {
    this.page = this.addPage();
    this.y = A4.height - MARGIN;
  }

  private addPage(): PDFPage {
    const page = this.pdf.addPage([A4.width, A4.height]);
    const footer = `${RESORT.name} \u00b7 ${RESORT.location}`;
    const size = 8;
    const w = this.fonts.oblique.widthOfTextAtSize(footer, size);
    page.drawText(footer, {
      x: (A4.width - w) / 2,
      y: MARGIN - 18,
      size,
      font: this.fonts.oblique,
      color: MUTED,
    });
    return page;
  }

  /** Start a new page if fewer than `needed` points remain on this one. */
  ensure(needed: number): void {
    if (this.y - needed < BOTTOM) {
      this.page = this.addPage();
      this.y = A4.height - MARGIN;
    }
  }

  drawCentered(text: string, font: PDFFont, size: number, color = INK): void {
    const w = font.widthOfTextAtSize(text, size);
    this.page.drawText(text, {
      x: (A4.width - w) / 2,
      y: this.y,
      size,
      font,
      color,
    });
  }

  drawLeft(
    text: string,
    font: PDFFont,
    size: number,
    color = INK,
    indent = 0,
  ): void {
    this.page.drawText(text, {
      x: MARGIN + indent,
      y: this.y,
      size,
      font,
      color,
    });
  }

  /** Wrap and draw a centered paragraph, advancing the cursor per line. */
  centeredParagraph(
    text: string,
    font: PDFFont,
    size: number,
    color = INK,
    maxWidth = CONTENT_WIDTH,
    lineGap = 3,
  ): void {
    const lines = wrapText(text, font, size, maxWidth);
    for (const line of lines) {
      this.ensure(size + lineGap);
      this.drawCentered(line, font, size, color);
      this.y -= size + lineGap;
    }
  }

  /** Wrap and draw a left-aligned paragraph, advancing the cursor per line. */
  paragraph(
    text: string,
    font: PDFFont,
    size: number,
    color = INK,
    indent = 0,
    lineGap = 2.5,
  ): void {
    const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      this.ensure(size + lineGap);
      this.drawLeft(line, font, size, color, indent);
      this.y -= size + lineGap;
    }
  }

  rule(color = GOLD, thickness = 0.75): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.width - MARGIN, y: this.y },
      thickness,
      color,
    });
  }
}

/** Estimated height of a dish entry (name row + wrapped description). */
function itemHeight(
  item: { name: string; description?: string },
  fonts: Fonts,
): number {
  let h = 15; // name row
  if (item.description) {
    const lines = wrapText(item.description, fonts.regular, 8.5, CONTENT_WIDTH - 12);
    h += lines.length * 11;
  }
  return h + 4;
}

function drawDish(
  cur: PageCursor,
  fonts: Fonts,
  item: { name: string; description?: string; price?: string; veg?: boolean },
): void {
  cur.ensure(itemHeight(item, fonts));

  const nameSize = 10;
  const name = item.veg ? `${item.name}  (V)` : item.name;
  cur.drawLeft(name, fonts.bold, nameSize, INK);

  if (item.price) {
    const priceSize = 9.5;
    const priceW = fonts.bold.widthOfTextAtSize(item.price, priceSize);
    cur.page.drawText(item.price, {
      x: A4.width - MARGIN - priceW,
      y: cur.y,
      size: priceSize,
      font: fonts.bold,
      color: NAVY,
    });
    // Dotted leader between name and price.
    const nameW = fonts.bold.widthOfTextAtSize(name, nameSize);
    const startX = MARGIN + nameW + 8;
    const endX = A4.width - MARGIN - priceW - 8;
    if (endX > startX) {
      cur.page.drawLine({
        start: { x: startX, y: cur.y + 2 },
        end: { x: endX, y: cur.y + 2 },
        thickness: 0.5,
        color: rgb(0.75, 0.75, 0.78),
        dashArray: [1, 3],
      });
    }
  }
  cur.y -= 13;

  if (item.description) {
    cur.paragraph(item.description, fonts.regular, 8.5, MUTED, 12, 2.5);
  }
  cur.y -= 4;
}

/** Build the branded A4 menu PDF. Returns the encoded PDF bytes. */
export async function buildMenuPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${RESORT.name} \u2013 ${MENU_TITLE}`);
  pdf.setAuthor(RESORT.name);

  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  const cur = new PageCursor(pdf, fonts);

  // --- Header ------------------------------------------------------------
  cur.y -= 6;
  cur.drawCentered(RESORT.name.toUpperCase(), fonts.bold, 15, NAVY);
  cur.y -= 14;
  cur.drawCentered(RESORT.location, fonts.regular, 9, MUTED);
  cur.y -= 24;
  cur.drawCentered("HALF BOARD & DAY PASS", fonts.bold, 9, GOLD);
  cur.y -= 24;
  cur.drawCentered(MENU_TITLE, fonts.bold, 22, NAVY);
  cur.y -= 20;
  cur.centeredParagraph(
    `\u201c${MENU_EPIGRAPH.quote}\u201d \u2014 ${MENU_EPIGRAPH.attribution}`,
    fonts.oblique,
    9.5,
    MUTED,
    CONTENT_WIDTH - 80,
  );
  cur.y -= 6;
  cur.rule(GOLD, 1.25);
  cur.y -= 18;

  // --- Intro ---------------------------------------------------------------
  cur.centeredParagraph(MENU_INTRO, fonts.regular, 9, INK, CONTENT_WIDTH - 40, 3.5);
  cur.y -= 14;

  // --- Dinner sections -------------------------------------------------------
  for (const section of DINNER_SECTIONS) {
    // Keep the heading with at least the first dish.
    const firstItem = section.items[0];
    cur.ensure(40 + (firstItem ? itemHeight(firstItem, fonts) : 0));

    cur.drawLeft(section.title, fonts.bold, 13, NAVY);
    cur.y -= 7;
    cur.rule(rgb(0.85, 0.78, 0.6), 0.6);
    cur.y -= 14;

    if (section.note) {
      cur.paragraph(section.note, fonts.oblique, 8.5, MUTED, 0, 2.5);
      cur.y -= 4;
    }

    for (const item of section.items) {
      drawDish(cur, fonts, item);
    }
    cur.y -= 10;
  }

  // --- Dessert note ----------------------------------------------------------
  cur.ensure(64);
  cur.rule(GOLD, 0.75);
  cur.y -= 18;
  cur.drawCentered(DESSERT_NOTE.title, fonts.bold, 13, NAVY);
  cur.y -= 16;
  cur.centeredParagraph(DESSERT_NOTE.text, fonts.regular, 9, MUTED, CONTENT_WIDTH - 60, 3);
  cur.y -= 14;

  // --- Breakfast ---------------------------------------------------------
  cur.ensure(90);
  cur.rule(GOLD, 1.25);
  cur.y -= 20;
  cur.drawCentered("EVERY MORNING", fonts.bold, 9, GOLD);
  cur.y -= 20;
  cur.drawCentered("Breakfast", fonts.bold, 18, NAVY);
  cur.y -= 15;
  cur.drawCentered("Choose your style each morning.", fonts.regular, 9, MUTED);
  cur.y -= 22;

  for (const style of BREAKFAST_STYLES) {
    // Keep the style heading with its first group label + first option.
    cur.ensure(56);
    cur.drawLeft(style.title, fonts.bold, 12.5, NAVY);
    cur.y -= 6;
    cur.rule(rgb(0.85, 0.78, 0.6), 0.6);
    cur.y -= 14;

    for (const group of style.groups) {
      cur.ensure(26);
      cur.drawLeft(group.label.toUpperCase(), fonts.bold, 8, GOLD);
      cur.y -= 12;
      for (const opt of group.options) {
        cur.paragraph(opt, fonts.regular, 9, INK, 10, 2.5);
      }
      cur.y -= 5;
    }
    cur.y -= 8;
  }

  // --- Closing note ------------------------------------------------------
  cur.ensure(40);
  cur.rule(GOLD, 0.75);
  cur.y -= 16;
  cur.drawCentered(
    "Menu items are subject to seasonal availability.",
    fonts.oblique,
    8.5,
    MUTED,
  );

  return pdf.save();
}
