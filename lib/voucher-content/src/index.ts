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

/**
 * Full Terms & Conditions for the Golden Jubilee Stay Voucher.
 *
 * This is the complete, authoritative offer document rendered on the web
 * `/terms` page, which has no space constraints. The condensed `VOUCHER_TERMS`
 * above remains the source for the single-page A4 voucher PDF. Keep the two in
 * sync on substantive points (rates, dates, blackout windows, perks, credit
 * rules); the full version simply carries more detail and sub-clauses.
 */
export const VOUCHER_TERMS_FULL: TermsSection[] = [
  {
    title: "1. The Offer",
    clauses: [
      "To mark 50 years of Seychelles Independence, The Seaboards Apartments is releasing a limited allocation of Golden Jubilee Stay Vouchers at specially reduced rates, payable in full or over three (3) monthly instalments.",
      "Each voucher is sold per room, per night, on a Half-Board basis and is fully stackable \u2014 guests may purchase as many nights as they wish, subject to availability and the blackout dates set out in Section 6. The minimum purchase is one (1) night.",
      "Standard Half-Board rates are SCR 3,285 (One-Bedroom, up to 2 adults) and SCR 5,520 (Two-Bedroom, up to 4 persons) per room, per night. The Golden Jubilee Half-Board rates are SCR 2,300 (One-Bedroom) and SCR 3,750 (Two-Bedroom) per room, per night \u2014 a saving of approximately 30\u201332%. All rates are quoted per room, per night, in Seychelles Rupees (SCR).",
    ],
  },
  {
    title: "2. What Is Included",
    clauses: [
      "Half Board for the named adult occupants \u2014 daily breakfast and a two-course dinner at the in-house restaurant.",
      "Children stay free of charge on a shared-room basis with an extra bed provided, where room capacity allows.",
      "A breakfast supplement of SCR 295 per child, per day applies for each child taking breakfast.",
      "Children's dinner is available \u00e0 la carte at separate cost and is not included in the Half Board package.",
      "Beverages are not included unless expressly stated in writing.",
    ],
  },
  {
    title: "3. The Golden Fifty Perk",
    clauses: [
      "The first fifty (50) Jubilee Vouchers sold will receive one (1) complimentary cocktail or mocktail per adult (up to two adults), served with dinner.",
      "The Perk is allocated strictly in order of completed booking and is limited to the first fifty (50) vouchers sold. It applies on one (1) evening of the stay, has no cash value, and is non-transferable.",
    ],
  },
  {
    title: "4. Payment & Voucher Issue",
    clauses: [
      "Guests may pay for their voucher(s) either in full at the time of booking, or over three (3) equal monthly instalments.",
      "Where payment is made in full, the voucher is issued immediately upon receipt of cleared payment.",
      "Under the instalment plan, Instalment 1 is payable at the time of booking and secures the Jubilee price; Instalments 2 and 3 fall due 30 and 60 days after the booking date respectively.",
      "Where payment is made by instalments, the voucher is issued only once the third (final) instalment has cleared in full. No voucher is valid, and no stay may be redeemed, until full payment is received.",
      "Illustrative single-night instalment schedule: One-Bedroom (SCR 2,300) \u2014 SCR 767, SCR 767, SCR 766; Two-Bedroom (SCR 3,750) \u2014 SCR 1,250, SCR 1,250, SCR 1,250. For multi-night vouchers, instalments are calculated as the total basket value divided by three.",
    ],
  },
  {
    title: "5. Missed or Incomplete Payments",
    clauses: [
      "If any instalment is not received by its due date, The Seaboards will attempt to recover the payment by issuing up to three (3) payment reminders over a grace period of fourteen (14) days from the missed due date.",
      "If the outstanding instalment is settled within the grace period, the payment plan continues unaffected and the schedule resumes as normal.",
      "If the plan is not brought up to date by the end of the grace period, the booking is cancelled, no room voucher is issued, and all amounts already paid are converted into non-refundable Ezzy Group Credit.",
      "Ezzy Group Credit may be redeemed against either of two sister services: Ezzy Foods (dining at the Ezzy Foods restaurant), or Ezzy Courier \u201cShop & Ship\u201d (shipping of goods from the United Arab Emirates to Seychelles, ezzycourrier.com).",
      "The credit is equal in value to the total instalments paid, is valid for twelve (12) months from the date of conversion, is non-refundable and non-transferable, and may not be exchanged for cash.",
      "No room amount paid under this offer is refundable in cash under any circumstances. The Jubilee rate is a non-refundable promotional rate.",
    ],
  },
  {
    title: "6. Validity & Blackout Dates",
    clauses: [
      "Vouchers are sold from 27 June 2026 until 30 June 2026, or until the limited Jubilee allocation is exhausted, whichever occurs first.",
      "Issued vouchers are redeemable for stays up to and including 30 June 2027, subject to availability.",
      "Vouchers may not be redeemed for stays falling, in whole or in part, within the blackout periods 15 July 2026 \u2013 31 August 2026 (inclusive) and 20 December 2026 \u2013 15 January 2027 (inclusive). Stays that overlap a blackout period, even partially, are not permitted under this offer.",
    ],
  },
  {
    title: "7. Availability & Booking",
    clauses: [
      "All stays are subject to availability at the time the voucher is redeemed. Purchasing a voucher does not, in itself, guarantee a specific date; guests are encouraged to confirm their stay dates as early as possible.",
      "Vouchers are subject to a minimum of one (1) night and are valid for the apartment type purchased only. A One-Bedroom voucher may not be applied to a Two-Bedroom apartment, or vice versa.",
    ],
  },
  {
    title: "8. Date Changes & Transfers",
    clauses: [
      "Once a voucher is issued, the guest may request a change of redemption dates subject to availability and the blackout dates. The Seaboards will use reasonable efforts to accommodate requested dates but does not guarantee any specific date.",
      "Vouchers are issued to the named purchaser and may not be re-sold. They may be gifted to a third party only with the prior written agreement of The Seaboards.",
    ],
  },
  {
    title: "9. General",
    clauses: [
      "This offer cannot be combined with any other promotion, discount, or corporate rate.",
      "The Seaboards reserves the right to amend or withdraw this offer at any time. Vouchers already issued will be honoured in accordance with these terms.",
      "These Terms & Conditions are governed by the laws of the Republic of Seychelles.",
      "All bookings are handled through The Seaboards' licensed booking entity. For any query relating to this offer, please contact reservations at " +
        RESORT.reservationsPhone +
        " (WhatsApp available).",
    ],
  },
];

/** Final acceptance / confirmation line shown beneath the clauses. */
export const TERMS_ACCEPTANCE =
  "By completing payment (or the first instalment under the payment plan), the guest confirms they have read, understood and accepted these Terms & Conditions.";

/** Plain-language validity summary used where no explicit expiry date exists. */
export const REDEMPTION_WINDOW = "Redeemable for stays until 30 June 2027";

/* ------------------------------------------------------------------ */
/* Half-Board Menu                                                     */
/* ------------------------------------------------------------------ */

/** A single dish on the à la carte / dinner menu. */
export interface MenuItem {
  /** Dish name. */
  name: string;
  /** Short description of ingredients or preparation. */
  description?: string;
  /** Display price, e.g. "SCR 175". Omit for items included in Half Board. */
  price?: string;
  /** True for vegetarian dishes (shown with a "V" marker). */
  veg?: boolean;
}

/** A titled group of dishes on the dinner menu. */
export interface MenuSection {
  title: string;
  /** Optional note shown under the section title. */
  note?: string;
  items: MenuItem[];
}

/** A choice group within a breakfast style (e.g. "Eggs Your Way"). */
export interface BreakfastGroup {
  label: string;
  options: string[];
}

/** One named breakfast style (American, Continental, English, German). */
export interface BreakfastStyle {
  title: string;
  groups: BreakfastGroup[];
}

/** Headline shown at the top of the menu page. */
export const MENU_TITLE = "Half Board & Day Pass Menu";

/** Short epigraph printed on the resort's menu. */
export const MENU_EPIGRAPH = {
  quote:
    "Better wait for your food, than the food waiting for you.",
  attribution: "Unknown",
} as const;

/** Plain-language summary of what Half Board and Day Pass include. */
export const MENU_INTRO =
  "Half Board includes daily breakfast and a two-course dinner \u2014 a main course and a dessert \u2014 for the named adult occupants. Day Pass includes lunch with one choice of main course. Beverages are not included unless stated. Prices shown are \u00e0 la carte reference prices for additional or extra orders beyond your package.";

/** Note explaining that the dessert selection changes each day. */
export const DESSERT_NOTE = {
  title: "Dessert",
  text: "A freshly prepared dessert menu is offered on a daily basis \u2014 ask your server for today's selection.",
} as const;

/** Dinner & à la carte menu, grouped by course. */
export const DINNER_SECTIONS: MenuSection[] = [
  {
    title: "Appetizers & Starters",
    items: [
      {
        name: "Mixed Garden Salad",
        description: "capsicum, cucumber, cabbage, lettuce, olives",
        price: "SCR 175",
        veg: true,
      },
      {
        name: "Cajun Spiced Seared Tuna",
        description: "garden leaves, marinated seared tuna",
        price: "SCR 195",
      },
      {
        name: "Smoked Fish Salad",
        description: "with garden salad, vinaigrette",
        price: "SCR 285",
      },
      {
        name: "Greek Salad",
        description: "feta, capsicum, cucumber, tomato, olives, onion",
        price: "SCR 285",
        veg: true,
      },
      {
        name: "Mixed Seafood Salad",
        description:
          "prawns, calamari, mussels, octopus, crab, vinaigrette, with garlic bread",
        price: "SCR 295",
      },
      {
        name: "Marinated Calamari",
        description: "with salad & garlic sauce",
        price: "SCR 295",
      },
      {
        name: "Prawns Torpedo",
        description: "fried breaded prawns with sweet chilli sauce",
        price: "SCR 285",
      },
      {
        name: "Soup of the Day",
        description: "chef selection of the day",
        price: "SCR 125",
        veg: true,
      },
      {
        name: "Prawns Cocktail",
        description: "tomato, lettuce, with marie rose sauce",
        price: "SCR 225",
      },
      {
        name: "Quinoa Salad",
        description: "with grilled vegetables, vinaigrette",
        price: "SCR 200",
        veg: true,
      },
    ],
  },
  {
    title: "From the Land",
    items: [
      {
        name: "Beef Steak",
        description: "steak fries served with pepper sauce",
      },
      {
        name: "Chicken Curry",
        description: "served with rice and chutney",
      },
      {
        name: "Buffalo Wings",
        description: "served with fries and salad",
      },
      {
        name: "Honey Glazed Pork",
        description: "served with fries and salad",
      },
      {
        name: "Vegetable Curry",
        description: "served with rice and chutney",
        veg: true,
      },
    ],
  },
  {
    title: "From the Ocean",
    items: [
      {
        name: "Catch of the Day",
        description:
          "marinated in creole sauce, accompanied by buttered vegetables",
      },
      {
        name: "Fish Trio",
        description: "tuna, job, jack fish, with grilled vegetables",
      },
      {
        name: "Fish Curry",
        description: "served with rice and chutney",
      },
      {
        name: "Prawns Curry",
        description: "served with rice and chutney",
      },
      {
        name: "Mixed Seafood Curry",
        description: "prawns, calamari, mussels, crab stick, eggplant",
      },
      {
        name: "Ocean Basket",
        description: "prawns, calamari, fish, mussels served with fries",
      },
    ],
  },
  {
    title: "Pasta & Burger",
    items: [
      { name: "Meat Tortellini", description: "in pomodoro sauce" },
      {
        name: "Cheesy Ravioli",
        description: "cooked in white cream sauce",
        veg: true,
      },
      {
        name: "Spaghetti Black Mussel",
        description: "onion, cream, white wine & parmigiano",
      },
      {
        name: "Spaghetti Vongole",
        description: "infused with garlic, clams, white wine",
      },
      {
        name: "Tomato Penne",
        description: "penne in tomato sauce",
        veg: true,
      },
      {
        name: "Classic Spaghetti Bolognese",
        description: "spaghetti in bolognese sauce",
      },
      {
        name: "Creamy Pesto Gnocchi",
        description: "gnocchi, cream, pesto",
        veg: true,
      },
      {
        name: "The Seaboards Burger",
        description:
          "beef patty, eggs, bacon, tomato, onions, cheese, served with fries and salad",
      },
    ],
  },
  {
    title: "Wraps & Tacos",
    items: [
      {
        name: "Tacos",
        description: "sizzling spiced pork, tomato salsa, guacamole",
      },
      {
        name: "Vegetable Wrap",
        description: "capsicum, cucumber, lettuce, onions, carrot",
        veg: true,
      },
      {
        name: "Chicken Wrap",
        description: "capsicum, cabbage, lettuce, onion",
      },
      {
        name: "Prawn Wrap",
        description: "capsicum, cabbage, lettuce, onion",
      },
      {
        name: "Tuna Wrap",
        description: "capsicum, cabbage, lettuce, onion",
      },
    ],
  },
];

/** Breakfast styles guests may choose from each morning. */
export const BREAKFAST_STYLES: BreakfastStyle[] = [
  {
    title: "American Breakfast",
    groups: [
      {
        label: "Eggs Your Way",
        options: [
          "Scrambled Eggs",
          "Omelettes (Plain, Ham & Cheese)",
          "Poached",
          "Fried Eggs (Sunny-side Up, Over Medium, Over Easy, Over Hard)",
        ],
      },
      { label: "American Pancake", options: ["Plain or with Honey"] },
      {
        label: "Sides",
        options: [
          "Hash Browns (2 per order)",
          "Bacon (2 per order) or Chicken Sausage (2 per order)",
        ],
      },
      {
        label: "Coffee & Tea",
        options: ["Coffee, Black Tea, Green Tea (1 per order)"],
      },
    ],
  },
  {
    title: "Continental Breakfast",
    groups: [
      { label: "Juices", options: ["Mix, Apple, Oranges"] },
      {
        label: "Coffee & Tea",
        options: ["Coffee, Black Tea, Green Tea (1 per order)"],
      },
      {
        label: "From the Bakery",
        options: [
          "Toast",
          "Baked Pastries (Croissant, Danish, Pain au Chocolat)",
        ],
      },
      {
        label: "Fruit Platter",
        options: ["Banana, Melon, Pineapple, Oranges (Seasonal)"],
      },
      {
        label: "Assorted Jams & Spreads",
        options: ["Strawberry Jam, Orange Marmalade, Honey, Butter"],
      },
    ],
  },
  {
    title: "English Breakfast",
    groups: [
      {
        label: "Eggs Your Way",
        options: [
          "Scrambled Eggs",
          "Omelettes (Plain, Ham & Cheese)",
          "Fried Eggs (Sunny-side Up, Over Medium, Over Easy, Over Hard)",
        ],
      },
      { label: "From the Bakery", options: ["Toast"] },
      {
        label: "Sides",
        options: [
          "Hash Browns (2 per order)",
          "Bacon (2 per order)",
          "Chicken Sausage (2 per order)",
          "Baked Beans",
          "Grilled Mushroom",
          "Grilled Tomatoes",
        ],
      },
      {
        label: "Coffee & Tea",
        options: ["Coffee, Black Tea, Green Tea (1 per order)"],
      },
    ],
  },
  {
    title: "German Breakfast",
    groups: [
      {
        label: "Eggs Your Way",
        options: [
          "Scrambled Eggs",
          "Omelettes (Plain, Ham & Cheese)",
          "Fried Eggs (Sunny-side Up, Over Medium, Over Easy, Over Hard)",
        ],
      },
      { label: "From the Bakery", options: ["Toast or Bread Rolls"] },
      {
        label: "Sides (choose from)",
        options: [
          "Muesli with dried fruits and Yogurt",
          "Overnight Oats (reserve 24hrs before)",
          "Oatmeal",
        ],
      },
      {
        label: "Assorted Jams & Spreads",
        options: ["Strawberry Jam, Nutella or Honey, Butter"],
      },
      {
        label: "Coffee & Tea",
        options: ["Coffee, Black Tea, Green Tea (1 per order)"],
      },
    ],
  },
];
