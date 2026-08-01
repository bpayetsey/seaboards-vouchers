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
  {
    id: "one-bedroom-bb",
    type: "package",
    ribbon: "One-Bedroom · B&B",
    featured: false,
    name: "One-Bedroom Apartment (Bed & Breakfast)",
    rate: 1950,
    was: 0,
    minNights: 1,
    desc: "A 58.7 sqm apartment opening to a private balcony with tropical mountain views — ideal for couples or a family with small children.",
    feat: [
      "58.7 sqm with private balcony",
      "Tropical mountain views",
      "Ideal for couples or a family with small children",
      "Bed & Breakfast included",
      "Valid for 1 year",
    ],
  },
  {
    id: "two-bedroom-bb",
    type: "package",
    ribbon: "Two-Bedroom · B&B",
    featured: false,
    name: "Two-Bedroom Apartment (Bed & Breakfast)",
    rate: 2850,
    was: 0,
    minNights: 1,
    desc: "A 71.2 sqm apartment with two queen-bed bedrooms (each en-suite), a spacious open-plan living area and a fully equipped kitchen — ideal for families or groups of 4–6 adults.",
    feat: [
      "71.2 sqm open-plan layout",
      "Two queen bedrooms, each en-suite",
      "Fully equipped kitchen",
      "Ideal for families or groups of 4–6 adults",
      "Bed & Breakfast included",
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

export interface DayPassExtension {
  label: string;
  /** Flat add-on price in the storefront currency. */
  price: number;
}

export interface DayPassOption {
  id: string;
  name: string;
  /**
   * "flat" = one price covering `includedAdults`; "per_person" = adult rate × adults.
   * Children (ages childAges) are always priced at `childRate` on top.
   */
  pricing: "flat" | "per_person";
  rate: number;
  /** Label for the price unit shown to buyers (e.g. "room", "person", "adult"). */
  unit: string;
  /** Maximum party size (adults + children) a single pass covers. */
  maxGuests: number;
  /** Per-child price (ages childAges), includes a kids-menu meal. */
  childRate: number;
  /** Human-readable child age band, e.g. "2–10 years". */
  childAges: string;
  /** Flat passes only: how many adults the flat `rate` covers (e.g. room = 2). */
  includedAdults?: number;
  /** Maximum number of children a single pass covers. */
  maxChildren?: number;
  /** Human-readable access window, e.g. "09:00 – 14:30". */
  hours: string;
  desc: string;
  feat: string[];
  /** Optional flat add-on (e.g. extend the room until 18:00). */
  extension?: DayPassExtension;
}

/**
 * Day Passes are fixed-price, same-day experiences sold as vouchers. They reuse
 * the storefront order → Stripe → voucher pipeline (no DB migration: prices are
 * server-authoritative here and the issued voucher simply carries the paid
 * value). Flat passes charge one price covering the included adults; per-person
 * passes charge the adult rate per adult. Children (ages childAges) are priced at
 * childRate on top of either, up to each option's maxGuests / maxChildren.
 */
export const DAY_PASSES: DayPassOption[] = [
  {
    id: "day-pass-room",
    name: "Day Pass with Room",
    pricing: "flat",
    rate: 1950,
    unit: "room",
    includedAdults: 2,
    maxChildren: 2,
    maxGuests: 4,
    childRate: 295,
    childAges: "2–10 years",
    hours: "09:00 – 14:30",
    desc: "A private One-Bedroom room for the day with breakfast and lunch — perfect for a couple's island escape.",
    feat: [
      "Private One-Bedroom room (09:00 – 14:30)",
      "À la carte breakfast",
      "Lunch — 1 main course per person",
      "Pool & day-bed access",
      "For 2 adults",
      "Add up to 2 children (2–10 yrs) at SCR 295 each, incl. kids-menu meal",
    ],
    extension: { label: "Extend the room until 18:00", price: 585 },
  },
  {
    id: "day-pass-bnl",
    name: "Day Pass — Breakfast & Lunch",
    pricing: "per_person",
    rate: 795,
    unit: "person",
    maxGuests: 6,
    childRate: 495,
    childAges: "2–10 years",
    hours: "09:00 – 16:00",
    desc: "Breakfast and lunch with full pool and day-bed access — no room.",
    feat: [
      "Access 09:00 – 16:00",
      "À la carte breakfast",
      "Lunch",
      "Pool & day-bed access",
      "Children (2–10 yrs): SCR 495 each, incl. kids-menu meal",
    ],
  },
  {
    id: "day-pass-pool",
    name: "Day Pass — Pool & Lunch",
    pricing: "per_person",
    rate: 550,
    unit: "adult",
    maxGuests: 6,
    childRate: 295,
    childAges: "2–10 years",
    hours: "09:00 – 16:00",
    desc: "Pool and day-bed access with lunch included — the easy way to spend a day at The Seaboards.",
    feat: [
      "Access 09:00 – 16:00",
      "Pool & day-bed access",
      "Lunch included",
      "Children (2–10 yrs): SCR 295 each, incl. kids-menu meal",
    ],
  },
];

export function getDayPass(id?: string): DayPassOption | undefined {
  if (!id) return undefined;
  return DAY_PASSES.find((d) => d.id === id);
}

/**
 * Day passes that support booking a specific visit date — the two per-person
 * passes (Breakfast & Lunch, Pool & Lunch). The "Day Pass with Room" is always
 * undated and never reserves a calendar slot.
 */
export const DATABLE_DAY_PASS_IDS = new Set(["day-pass-bnl", "day-pass-pool"]);

export function isDatableDayPass(productId?: string | null): boolean {
  return !!productId && DATABLE_DAY_PASS_IDS.has(productId);
}

/**
 * Server-validated party size (adults + children) for a day-pass order. Returns
 * null for non-day-pass orders or invalid selections, mirroring `priceFor`'s
 * bounds so pax can never be client-driven.
 */
export function paxFor({
  productId,
  type,
  adults,
  children,
}: {
  productId?: string;
  type?: string;
  adults?: number;
  children?: number;
}): number | null {
  if (type !== "day_pass") return null;
  const opt = getDayPass(productId);
  if (!opt) return null;
  const kids = Number(children ?? 0);
  if (!Number.isInteger(kids) || kids < 0) return null;
  if (opt.maxChildren != null && kids > opt.maxChildren) return null;
  let adultCount: number;
  if (opt.pricing === "flat") {
    adultCount = opt.includedAdults ?? 1;
  } else {
    adultCount = Number(adults);
    if (!Number.isInteger(adultCount) || adultCount < 1) return null;
  }
  const pax = adultCount + kids;
  if (pax < 1 || pax > opt.maxGuests) return null;
  return pax;
}

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
  adults,
  children,
  extension,
}: {
  productId?: string;
  type?: string;
  amount?: number;
  nights?: number;
  adults?: number;
  children?: number;
  extension?: boolean;
}): Promise<number | null> {
  if (type === "gift") {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < GIFT.min) return null;
    return Math.round(a * 100) / 100;
  }
  if (type === "day_pass") {
    const opt = getDayPass(productId);
    if (!opt) return null;
    const kids = Number(children ?? 0);
    if (!Number.isInteger(kids) || kids < 0) return null;
    if (opt.maxChildren != null && kids > opt.maxChildren) return null;
    let pax: number;
    let total: number;
    if (opt.pricing === "flat") {
      pax = opt.includedAdults ?? 1;
      total = opt.rate;
    } else {
      pax = Number(adults);
      if (!Number.isInteger(pax) || pax < 1) return null;
      total = opt.rate * pax;
    }
    if (pax + kids < 1 || pax + kids > opt.maxGuests) return null;
    total += kids * opt.childRate;
    if (extension && opt.extension) total += opt.extension.price;
    return Math.round(total * 100) / 100;
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
  adults,
  children,
  extension,
}: {
  productId?: string;
  type?: string;
  nights?: number;
  adults?: number;
  children?: number;
  extension?: boolean;
}): string {
  if (type === "gift") return GIFT.name;
  if (type === "day_pass") {
    const opt = getDayPass(productId);
    if (!opt) return "Day Pass";
    let name = opt.name;
    const pax = opt.pricing === "flat" ? (opt.includedAdults ?? 1) : Number(adults);
    const kids = Number(children ?? 0);
    const parts: string[] = [];
    if (Number.isInteger(pax) && pax > 0) {
      parts.push(`${pax} adult${pax === 1 ? "" : "s"}`);
    }
    if (Number.isInteger(kids) && kids > 0) {
      parts.push(`${kids} child${kids === 1 ? "" : "ren"}`);
    }
    if (parts.length) name += ` — ${parts.join(", ")}`;
    if (extension && opt.extension) name += " + room extension to 18:00";
    return name;
  }
  const item = CATALOG.find((v) => v.id === productId);
  if (!item) return "Voucher";
  const n = Number(nights);
  if (Number.isInteger(n) && n > 0) {
    return `${item.name} — ${n} night${n === 1 ? "" : "s"}`;
  }
  return item.name;
}
