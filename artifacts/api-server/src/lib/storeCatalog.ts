/**
 * Single source of truth for the storefront campaign. The storefront pulls this
 * from /api/storefront/config so prices can never drift between the page and the
 * server. Prices are validated server-side from this file, so the client can't
 * tamper with them.
 */

export const SYMBOLS: Record<string, string> = {
  eur: "€",
  usd: "$",
  scr: "₨",
  gbp: "£",
};

export const SETTINGS = {
  // Stripe settles in the currencies your account country allows; SCR is usually
  // not supported, so the storefront defaults to EUR. Override with STORE_CURRENCY.
  currency: (process.env.STORE_CURRENCY || "eur").toLowerCase(),
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
  price: number;
  was: number;
  desc: string;
  feat: string[];
}

export const CATALOG: CatalogItem[] = [
  {
    id: "twonight",
    type: "package",
    ribbon: "Most popular",
    featured: false,
    name: "Jubilee Two-Night Escape",
    price: 280,
    was: 340,
    desc: "Two nights for two in a sea-breeze apartment, with a welcome basket of island treats.",
    feat: [
      "2 nights, sleeps 2",
      "Welcome basket on arrival",
      "Late check-out where available",
    ],
  },
  {
    id: "goldenweek",
    type: "package",
    ribbon: "Best value",
    featured: true,
    name: "Golden Week — 5 Nights",
    price: 620,
    was: 780,
    desc: "Five nights to settle into island time. Our headline 50th-anniversary stay.",
    feat: [
      "5 nights, sleeps up to 4",
      "Welcome basket + island map",
      "One sunset boat add-on credit",
      "Late check-out where available",
    ],
  },
  {
    id: "family",
    type: "package",
    ribbon: "For families",
    featured: false,
    name: "Family Independence Week",
    price: 540,
    was: 660,
    desc: "A family-sized apartment for the school holidays around National Day.",
    feat: [
      "4 nights, family apartment",
      "Kids welcome pack",
      "Flexible school-holiday dates",
    ],
  },
];

export const GIFT = {
  id: "gift",
  type: "gift" as const,
  name: "Jubilee Gift Voucher",
  amounts: [100, 200, 350, 500],
  min: 50,
};

/** Validate an incoming order against the catalog so the price can't be tampered with. */
export function priceFor({
  productId,
  type,
  amount,
}: {
  productId?: string;
  type?: string;
  amount?: number;
}): number | null {
  if (type === "gift") {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < GIFT.min) return null;
    return Math.round(a * 100) / 100;
  }
  const item = CATALOG.find((v) => v.id === productId);
  return item ? item.price : null;
}

export function nameFor({
  productId,
  type,
}: {
  productId?: string;
  type?: string;
}): string {
  if (type === "gift") return GIFT.name;
  return CATALOG.find((v) => v.id === productId)?.name || "Voucher";
}
