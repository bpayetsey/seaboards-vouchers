// Single source of truth for the campaign. The storefront pulls this from
// /api/config so prices can never drift between the page and the server.

export const SYMBOLS = { eur: "€", usd: "$", scr: "₨", gbp: "£" };

export const SETTINGS = {
  currency: (process.env.CURRENCY || "eur").toLowerCase(),
  instalments: Number(process.env.INSTALMENTS || 3),
  intervalDays: Number(process.env.INTERVAL_DAYS || 30),
  issueOn: process.env.ISSUE_ON || "paid",
};

// Package vouchers (fixed price) + an open-value gift voucher (priced by buyer).
export const CATALOG = [
  {
    id: "twonight", type: "package", ribbon: "Most popular", featured: false,
    name: "Jubilee Two-Night Escape", price: 280, was: 340,
    desc: "Two nights for two in a sea-breeze apartment, with a welcome basket of island treats.",
    feat: ["2 nights, sleeps 2", "Welcome basket on arrival", "Late check-out where available"],
  },
  {
    id: "goldenweek", type: "package", ribbon: "Best value", featured: true,
    name: "Golden Week — 5 Nights", price: 620, was: 780,
    desc: "Five nights to settle into island time. Our headline 50th-anniversary stay.",
    feat: ["5 nights, sleeps up to 4", "Welcome basket + island map", "One sunset boat add-on credit", "Late check-out where available"],
  },
  {
    id: "family", type: "package", ribbon: "For families", featured: false,
    name: "Family Independence Week", price: 540, was: 660,
    desc: "A family-sized apartment for the school holidays around National Day.",
    feat: ["4 nights, family apartment", "Kids welcome pack", "Flexible school-holiday dates"],
  },
];

export const GIFT = { id: "gift", type: "gift", name: "Jubilee Gift Voucher", amounts: [100, 200, 350, 500], min: 50 };

// Validate an incoming order against the catalog so the price can't be tampered with.
export function priceFor({ productId, type, amount }) {
  if (type === "gift") {
    const a = Number(amount);
    if (!Number.isFinite(a) || a < GIFT.min) return null;
    return Math.round(a * 100) / 100;
  }
  const item = CATALOG.find((v) => v.id === productId);
  return item ? item.price : null;
}

export function nameFor({ productId, type }) {
  if (type === "gift") return GIFT.name;
  return CATALOG.find((v) => v.id === productId)?.name || "Voucher";
}
