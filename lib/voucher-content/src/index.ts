/**
 * Single source of truth for Seaboards Golden Jubilee voucher content.
 *
 * Both the on-page `/terms` route (web artifact) and the downloadable A4 voucher
 * PDF (api-server) render the resort branding and Terms & Conditions from this
 * module so the two can never drift apart.
 *
 * The clauses below are the *condensed essentials* — deliberately concise so the
 * voucher code, value and the full T&C fit on a single A4 page.
 */

export const RESORT = {
  name: "The Seaboards Apartments",
  location: "Anse \u00e0 la Mouche \u00b7 Mah\u00e9 \u00b7 Seychelles",
  offerTitle: "Golden Jubilee Stay Voucher",
  jubileeTagline: "Seychelles Golden Jubilee \u00b7 50 Years \u00b7 1976\u20132026",
  reservationsPhone: "+248 4 303 151",
} as const;

export interface TermsSection {
  /** Short section title, e.g. "The Offer". */
  title: string;
  /** One or more self-contained clauses written in plain prose. */
  clauses: string[];
}

/**
 * Condensed Terms & Conditions for the Golden Jubilee Stay Voucher. Every
 * essential legal point from the full offer terms is preserved here in compact
 * form. When the offer rates, dates, blackout windows or perks change, update
 * these clauses (and the storefront offer copy) together.
 */
export const VOUCHER_TERMS: TermsSection[] = [
  {
    title: "1. The Offer",
    clauses: [
      "Golden Jubilee Stay Vouchers are sold per room, per night, on a Half-Board basis and are fully stackable, with a minimum stay of one (1) night.",
      "Jubilee Half-Board rates: One-Bedroom Apartment (up to 2 adults) SCR 2,300 per night; Two-Bedroom Apartment (up to 4 persons) SCR 3,750 per night. Each voucher is valid only for the apartment type purchased.",
    ],
  },
  {
    title: "2. What's Included",
    clauses: [
      "Half Board for the named adult occupants: daily breakfast and a two-course dinner. Beverages are not included unless stated in writing.",
      "Children may stay free on a shared-room basis where capacity allows; a breakfast supplement of SCR 295 per child per day applies.",
      "Golden Fifty perk: the first fifty (50) vouchers sold include one complimentary cocktail or mocktail per adult (max two adults) on one evening of the stay.",
    ],
  },
  {
    title: "3. Payment & Voucher Issue",
    clauses: [
      "Pay in full and the voucher is issued immediately once payment clears.",
      "Pay by three (3) monthly instalments (Instalment 1 at booking, the remainder at 30 and 60 days); the voucher is issued only once the final instalment has cleared.",
    ],
  },
  {
    title: "4. Missed Payments & Credit",
    clauses: [
      "If an instalment is missed, up to three reminders are sent over a 14-day grace period. If still unsettled, the booking is cancelled and all amounts paid convert to non-refundable Ezzy Group Credit (valid 12 months, redeemable at Ezzy Foods or Ezzy Courier \u201cShop & Ship\u201d).",
      "No room amount paid under this offer is refundable in cash.",
    ],
  },
  {
    title: "5. Validity & Blackout Dates",
    clauses: [
      "Vouchers are sold from 27 June 2026 until 30 June 2026 (or until the allocation is exhausted) and are redeemable for stays up to and including 30 June 2027, subject to availability.",
      "Stays may not fall, even partially, within the blackout periods 15 July \u2013 31 August 2026 and 20 December 2026 \u2013 15 January 2027 (inclusive).",
    ],
  },
  {
    title: "6. Booking & Transfers",
    clauses: [
      "All stays are subject to availability at the time of redemption; a voucher does not guarantee any specific date. Reserve early on " +
        RESORT.reservationsPhone +
        " (WhatsApp available).",
      "Vouchers are issued to the named purchaser, may not be re-sold, and may be gifted only with The Seaboards' prior written agreement. This offer cannot be combined with any other promotion and is governed by the laws of the Republic of Seychelles.",
    ],
  },
];

/** Final acceptance / confirmation line shown beneath the clauses. */
export const TERMS_ACCEPTANCE =
  "By completing payment, the guest confirms they have read, understood and accepted these Terms & Conditions.";

/** Plain-language validity summary used where no explicit expiry date exists. */
export const REDEMPTION_WINDOW = "Redeemable for stays until 30 June 2027";
