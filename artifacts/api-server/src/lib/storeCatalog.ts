/**
 * Single source of truth for the storefront campaign. The storefront pulls this
 * from /api/storefront/config so prices can never drift between the page and the
 * server. Prices are validated server-side from this file, so the client can't
 * tamper with them.
 *
 * Default rates/strike-through prices live here, but staff can override them
 * per item from the admin (stored in `store_catalog_price`). `getEffectiveCatalog`
 * merges any overrides onto these defaults, and all pricing goes through it so
 * the storefront, order validation and group split pricing stay consistent.
 */

import { db, storeCatalogPrices } from "@workspace/db";

export const SYMBOLS: Record<string, string> = {
  eur: "€",
  usd: "$",
  scr: "SCR ",
  gbp: "£",
};

export const SETTINGS = {
  // Prices are shown in SCR per the resort's request. Stripe almost never
  // settles SCR, so when live payments are connected the charge currency will
  // need revisiting (e.g. display SCR but charge EUR). Override with STORE_CURRENCY.
  currency: (process.env.STORE_CURRENCY || "scr").toLowerCase(),
  instalments: Number(process.env.INSTALMENTS || 3),
  intervalDays: Number(process.env.INTERVAL_DAYS || 30),
  // "paid" = issue only when fully paid (safer); "deposit" = issue after instalment 1.
  issueOn: process.env.ISSUE_ON === "deposit" ? "deposit" : "paid",
};

export interface CatalogItem {
  id: string;
  type: "package";
  ribbon: string;
  featured: boolean;
  name: string;
  rate: number;
  was: number;
  minNights: number;
  desc: string;
  feat: string[];
}

export const CATALOG: CatalogItem[] = [
  {
    id: "one-bedroom",
    type: "package",
    ribbon: "One-Bedroom",
    featured: false,
    name: "One-Bedroom Apartment",
    rate: 2300,
    was: 3285,
    minNights: 1,
    desc: "A 58.7 sqm apartment opening to a private balcony with tropical mountain views — ideal for couples or a family with small children.",
    feat: [
      "58.7 sqm with private balcony",
      "Tropical mountain views",
      "Ideal for couples or a family with small children",
      "Half Board included",
      "Valid for 1 year",
    ],
  },
  {
    id: "two-bedroom",
    type: "package",
    ribbon: "Two-Bedroom",
    featured: true,
    name: "Two-Bedroom Apartment",
    rate: 3750,
    was: 5520,
    minNights: 1,
    desc: "A 71.2 sqm apartment with two queen-bed bedrooms (each en-suite), a spacious open-plan living area and a fully equipped kitchen — ideal for families or groups of 4–6 adults.",
    feat: [
      "71.2 sqm open-plan layout",
      "Two queen bedrooms, each en-suite",
      "Fully equipped kitchen",
      "Ideal for families or groups of 4–6 adults",
      "Half Board included",
      "Valid for 1 year",
    ],
  },
];

export const GIFT = {
  id: "gift",
  type: "gift" as const,
  name: "Gift Voucher for Ezzy Foods - On Site Dine In",
  amounts: [100, 200, 350, 500],
  min: 50,
};

/**
 * The catalog with any staff price overrides applied. Falls back to the
 * built-in defaults if the overrides can't be read, so the storefront never
 * goes dark over a transient DB issue.
 */
export async function getEffectiveCatalog(): Promise<CatalogItem[]> {
  let overrides: Record<string, { rate: number; was: number }> = {};
  try {
    const rows = await db.select().from(storeCatalogPrices);
    overrides = Object.fromEntries(
      rows.map((r) => [r.itemId, { rate: r.rate, was: r.was }]),
    );
  } catch {
    overrides = {};
  }
  return CATALOG.map((item) => {
    const o = overrides[item.id];
    return o ? { ...item, rate: o.rate, was: o.was } : item;
  });
}

/** Validate an incoming order against the catalog so the price can't be tampered with. */
export async function priceFor({
  productId,
  type,
  amount,
  nights,
}: {
  productId?: string;
  type?: string;
  amount?: number;
  nights?: number;
}): Promise<number | null> {
  if (type === "gift") {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < GIFT.min) return null;
    return Math.round(a * 100) / 100;
  }
  const catalog = await getEffectiveCatalog();
  const item = catalog.find((v) => v.id === productId);
  if (!item) return null;
  const n = Number(nights);
  if (!Number.isInteger(n) || n < item.minNights) return null;
  return Math.round(item.rate * n * 100) / 100;
}

export function nameFor({
  productId,
  type,
  nights,
}: {
  productId?: string;
  type?: string;
  nights?: number;
}): string {
  if (type === "gift") return GIFT.name;
  const item = CATALOG.find((v) => v.id === productId);
  if (!item) return "Voucher";
  const n = Number(nights);
  if (Number.isInteger(n) && n > 0) {
    return `${item.name} — ${n} night${n === 1 ? "" : "s"}`;
  }
  return item.name;
}
