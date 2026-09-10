import { db, storeCatalogPrices } from "@workspace/db";
import {
  CATALOG,
  DAY_PASSES,
  SETTINGS,
  SYMBOLS,
  getEffectiveCatalog,
  getEffectiveDayPasses,
} from "./storeCatalog";

export interface AdminCatalogPriceItem {
  id: string;
  /** Which pricing fields apply — see field docs below. */
  type: "package" | "day_pass";
  name: string;
  /** Package: per-night price. Day pass: per-adult (or flat) price. */
  rate: number;
  /** Package only (struck-through original price). Null for day passes. */
  was: number | null;
  /** Package only. Null for day passes. */
  min_nights: number | null;
  /** Day pass only (per-child price). Null for packages. */
  child_rate: number | null;
}

export interface AdminCatalogPrices {
  currency: string;
  symbol: string;
  items: AdminCatalogPriceItem[];
}

/**
 * Editable prices — apartment packages and day passes — with any staff
 * overrides applied, for the admin screen.
 */
export async function listCatalogPrices(): Promise<AdminCatalogPrices> {
  const [catalog, dayPasses] = await Promise.all([
    getEffectiveCatalog(),
    getEffectiveDayPasses(),
  ]);
  const cur = SETTINGS.currency;
  const packageItems: AdminCatalogPriceItem[] = catalog.map((i) => ({
    id: i.id,
    type: "package",
    name: i.name,
    rate: i.rate,
    was: i.was,
    min_nights: i.minNights,
    child_rate: null,
  }));
  const dayPassItems: AdminCatalogPriceItem[] = dayPasses.map((d) => ({
    id: d.id,
    type: "day_pass",
    name: d.name,
    rate: d.rate,
    was: null,
    min_nights: null,
    child_rate: d.childRate,
  }));
  return {
    currency: cur,
    symbol: SYMBOLS[cur] ?? "",
    items: [...packageItems, ...dayPassItems],
  };
}

export type UpdateCatalogPriceResult =
  | { item: AdminCatalogPriceItem }
  | { error: "not_found" | "invalid" };

/** Upsert a staff price override for a single apartment package or day pass. */
export async function updateCatalogPrice(
  itemId: string,
  input: { rate: number; was?: number | null; childRate?: number | null },
): Promise<UpdateCatalogPriceResult> {
  const packageBase = CATALOG.find((i) => i.id === itemId);
  const dayPassBase = packageBase
    ? undefined
    : DAY_PASSES.find((d) => d.id === itemId);
  if (!packageBase && !dayPassBase) return { error: "not_found" };

  const rate = Number(input.rate);
  if (!Number.isInteger(rate) || rate <= 0) return { error: "invalid" };

  if (packageBase) {
    const was = Number(input.was ?? 0);
    if (!Number.isInteger(was) || was < 0) return { error: "invalid" };
    await db
      .insert(storeCatalogPrices)
      .values({ itemId, rate, was })
      .onConflictDoUpdate({
        target: storeCatalogPrices.itemId,
        set: { rate, was, updatedAt: new Date() },
      });
    return {
      item: {
        id: itemId,
        type: "package",
        name: packageBase.name,
        rate,
        was,
        min_nights: packageBase.minNights,
        child_rate: null,
      },
    };
  }

  // Day pass — fall back to the built-in default child rate if the client
  // didn't send one, so a package-only client can never blank it out.
  const childRate = Number(input.childRate ?? dayPassBase!.childRate);
  if (!Number.isInteger(childRate) || childRate < 0) {
    return { error: "invalid" };
  }
  await db
    .insert(storeCatalogPrices)
    .values({ itemId, rate, was: 0, childRate })
    .onConflictDoUpdate({
      target: storeCatalogPrices.itemId,
      set: { rate, childRate, updatedAt: new Date() },
    });
  return {
    item: {
      id: itemId,
      type: "day_pass",
      name: dayPassBase!.name,
      rate,
      was: null,
      min_nights: null,
      child_rate: childRate,
    },
  };
}
