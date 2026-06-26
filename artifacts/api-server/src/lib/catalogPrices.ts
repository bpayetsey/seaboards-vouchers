import { eq } from "drizzle-orm";
import { db, storeCatalogPrices } from "@workspace/db";
import {
  CATALOG,
  SETTINGS,
  SYMBOLS,
  getEffectiveCatalog,
} from "./storeCatalog";

export interface AdminCatalogPriceItem {
  id: string;
  name: string;
  rate: number;
  was: number;
  min_nights: number;
}

export interface AdminCatalogPrices {
  currency: string;
  symbol: string;
  items: AdminCatalogPriceItem[];
}

function toItem(i: {
  id: string;
  name: string;
  rate: number;
  was: number;
  minNights: number;
}): AdminCatalogPriceItem {
  return {
    id: i.id,
    name: i.name,
    rate: i.rate,
    was: i.was,
    min_nights: i.minNights,
  };
}

/** Editable catalog prices with any overrides applied, for the admin screen. */
export async function listCatalogPrices(): Promise<AdminCatalogPrices> {
  const catalog = await getEffectiveCatalog();
  const cur = SETTINGS.currency;
  return {
    currency: cur,
    symbol: SYMBOLS[cur] ?? "",
    items: catalog.map(toItem),
  };
}

export type UpdateCatalogPriceResult =
  | { item: AdminCatalogPriceItem }
  | { error: "not_found" | "invalid" };

/** Upsert a staff price override for a single catalog item. */
export async function updateCatalogPrice(
  itemId: string,
  input: { rate: number; was: number },
): Promise<UpdateCatalogPriceResult> {
  const base = CATALOG.find((i) => i.id === itemId);
  if (!base) return { error: "not_found" };

  const rate = Number(input.rate);
  const was = Number(input.was);
  if (!Number.isInteger(rate) || rate <= 0) return { error: "invalid" };
  if (!Number.isInteger(was) || was < 0) return { error: "invalid" };

  await db
    .insert(storeCatalogPrices)
    .values({ itemId, rate, was })
    .onConflictDoUpdate({
      target: storeCatalogPrices.itemId,
      set: { rate, was, updatedAt: new Date() },
    });

  return { item: toItem({ ...base, rate, was }) };
}
