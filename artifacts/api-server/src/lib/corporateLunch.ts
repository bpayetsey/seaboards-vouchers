import {
  CORPORATE_LUNCH,
  CORPORATE_LUNCH_COURSES,
  type CorporateLunchCourseId,
} from "@workspace/voucher-content";

/**
 * Ingredient cost per person (SCR) for each dish, on a full set-menu share
 * (about 130 g raw protein per main). Source: Corporate_Lunch_Recipe_Costing.pdf
 * (4 Nov 2026) — October 2026 purchase invoices plus estimates where no invoice
 * was on file. Server-only: never send these to the browser.
 */
export const DISH_COST_SCR: Record<string, number> = {
  "green-salad": 12.1,
  "grilled-vegetables": 14.94,
  soup: 11.06,
  "smoked-fish-salad": 15.55,
  "seafood-salad": 12.3,
  "mixed-grill": 27.39,
  "beef-stir-fry": 42.64,
  "chicken-curry": 21.16,
  "lamb-curry": 42.86,
  "chow-mein": 13.29,
  "grilled-fish": 32.83,
  "garlic-prawns": 30.55,
  "pasta-carbonara": 29.55,
  "honey-glazed-pork": 22.77,
  "pasta-ravioli": 43.98,
  "roast-beef": 41.84,
  "chicken-mushroom": 31.18,
  "octopus-curry": 48.35,
  "white-rice": 3.2,
  "yellow-rice": 4.76,
  "ice-cream": 9.0,
  "banana-caramel": 7.13,
  cheesecake: 31.67,
};

/** Pricing levers. Edit here; the public page and admin view follow. */
export const CORPORATE_LUNCH_PRICING = {
  /** Food + wine as a share of the set-menu price. */
  targetFoodCost: 0.35,
  wastage: 0.1,
  /** Cost per person of the complimentary glass of house wine. */
  wineCost: 40,
  /** Gas, chafing fuel, napkins, bread. */
  consumablesCost: 20,
  roundTo: 25,
  /** Food an extra dish adds, as a share of a full portion. */
  extraPortion: 0.5,
  /** Fixed kitchen + service labour per event (4 staff x 6 h x SCR 90). */
  labourPerEvent: 2160,
} as const;

export type CorporateLunchSelection = Record<CorporateLunchCourseId, string[]>;

export interface CorporateLunchExtra {
  dishId: string;
  name: string;
  pricePerPerson: number;
}

export interface CorporateLunchQuote {
  complete: boolean;
  issues: string[];
  guests: number;
  setMenuPerPerson: number;
  extrasPerPerson: number;
  pricePerPerson: number;
  total: number;
  extras: CorporateLunchExtra[];
}

export interface CorporateLunchCosting {
  foodCostPerPerson: number;
  totalCostPerPerson: number;
  labour: number;
  profit: number;
  margin: number;
}

export class CorporateLunchInputError extends Error {}

/**
 * Normalises a raw selection: known dish ids only, each in its own course,
 * de-duplicated. Throws on unknown ids so a tampered request is rejected.
 */
export function normaliseSelection(raw: unknown): CorporateLunchSelection {
  const input = (raw ?? {}) as Partial<Record<string, unknown>>;
  const out = {} as CorporateLunchSelection;
  for (const course of CORPORATE_LUNCH_COURSES) {
    const ids = Array.isArray(input[course.id]) ? (input[course.id] as unknown[]) : [];
    const valid = new Set(course.dishes.map((d) => d.id));
    const picked: string[] = [];
    for (const id of ids) {
      if (typeof id !== "string" || !valid.has(id)) {
        throw new CorporateLunchInputError(`Unknown dish "${String(id)}" in ${course.name}.`);
      }
      if (!picked.includes(id)) picked.push(id);
    }
    out[course.id] = picked;
  }
  return out;
}

/**
 * Prices a menu. The most expensive picks in each course fill the set menu
 * (so the set price always covers premium dishes); every further dish is an
 * extra at its course's flat price per person.
 */
export function quoteCorporateLunch(
  selection: CorporateLunchSelection,
  guests: number,
): { quote: CorporateLunchQuote; costing: CorporateLunchCosting } {
  const P = CORPORATE_LUNCH_PRICING;
  const issues: string[] = [];
  if (!Number.isInteger(guests) || guests < CORPORATE_LUNCH.minGuests || guests > CORPORATE_LUNCH.maxGuests) {
    issues.push(`Guests must be between ${CORPORATE_LUNCH.minGuests} and ${CORPORATE_LUNCH.maxGuests}.`);
  }

  let includedFood = 0;
  let extraFood = 0;
  let extrasPerPerson = 0;
  const extras: CorporateLunchExtra[] = [];

  for (const course of CORPORATE_LUNCH_COURSES) {
    const chosen = course.dishes
      .filter((d) => selection[course.id]?.includes(d.id))
      .sort((a, b) => (DISH_COST_SCR[b.id] ?? 0) - (DISH_COST_SCR[a.id] ?? 0));
    if (chosen.length < course.min) {
      issues.push(`Choose at least ${course.min} from ${course.name}.`);
    }
    const included = chosen.slice(0, course.included);
    const additional = chosen.slice(course.included);
    if (included.length) {
      const avg = included.reduce((s, d) => s + (DISH_COST_SCR[d.id] ?? 0), 0) / included.length;
      includedFood += avg * course.included;
    }
    for (const d of additional) {
      extraFood += (DISH_COST_SCR[d.id] ?? 0) * P.extraPortion;
      const price = d.premium && course.extraPremiumPrice ? course.extraPremiumPrice : course.extraPrice;
      extrasPerPerson += price;
      extras.push({ dishId: d.id, name: d.name, pricePerPerson: price });
    }
  }

  const fixedPerPerson = P.wineCost + P.consumablesCost;
  // The set-menu price follows the dishes chosen but never drops below the
  // advertised starting price.
  const setMenuPerPerson = Math.max(
    CORPORATE_LUNCH.startingPrice,
    Math.ceil((includedFood * (1 + P.wastage) + fixedPerPerson) / P.targetFoodCost / P.roundTo) * P.roundTo,
  );
  const pricePerPerson = setMenuPerPerson + extrasPerPerson;
  const safeGuests = Number.isFinite(guests) && guests > 0 ? guests : 0;

  const foodCostPerPerson = (includedFood + extraFood) * (1 + P.wastage);
  const totalCostPerPerson = foodCostPerPerson + fixedPerPerson;
  const revenue = pricePerPerson * safeGuests;
  const profit = revenue - totalCostPerPerson * safeGuests - P.labourPerEvent;

  return {
    quote: {
      complete: issues.length === 0,
      issues,
      guests: safeGuests,
      setMenuPerPerson,
      extrasPerPerson,
      pricePerPerson,
      total: revenue,
      extras,
    },
    costing: {
      foodCostPerPerson: round2(foodCostPerPerson),
      totalCostPerPerson: round2(totalCostPerPerson),
      labour: P.labourPerEvent,
      profit: round2(profit),
      margin: revenue > 0 ? round2(profit / revenue) : 0,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
