import { eq } from "drizzle-orm";
import { db, siteSettings } from "@workspace/db";

/** Stable key for the storefront promo banner setting. */
export const PROMO_BANNER_KEY = "promo_banner";

/**
 * Default promo banner copy. Used to seed the setting on first read so staff
 * have something to edit; an explicit empty value (set later by staff) is kept
 * as-is and tells the public pages to hide the banner.
 */
export const DEFAULT_PROMO_BANNER =
  "Voucher for sale from 27 June – 15th July 2026, while allocation lasts. Blackout dates apply.";

/**
 * Read the promo banner text. Seeds the default copy on first access (so the
 * row exists for staff to edit/clear), then returns the stored value — which
 * may be an empty string once staff clear it.
 */
export async function getPromoBanner(): Promise<string> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, PROMO_BANNER_KEY));
  if (!row) {
    await db
      .insert(siteSettings)
      .values({ key: PROMO_BANNER_KEY, value: DEFAULT_PROMO_BANNER })
      .onConflictDoNothing();
    return DEFAULT_PROMO_BANNER;
  }
  return row.value;
}

/** Upsert the promo banner text. Trims surrounding whitespace; empty is valid. */
export async function updatePromoBanner(value: string): Promise<string> {
  const trimmed = value.trim();
  await db
    .insert(siteSettings)
    .values({ key: PROMO_BANNER_KEY, value: trimmed })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: trimmed, updatedAt: new Date() },
    });
  return trimmed;
}

/**
 * Stable key for the WhatsApp voucher-confirmation template setting. The value
 * is the NAME of a Meta-approved template; empty string means "not set" and the
 * WhatsApp confirmation send is skipped (with a log line).
 */
export const WHATSAPP_CONFIRMATION_TEMPLATE_KEY =
  "whatsapp_confirmation_template";

/** Read the configured confirmation template name ("" = unset → skip). */
export async function getWhatsappConfirmationTemplate(): Promise<string> {
  const [row] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, WHATSAPP_CONFIRMATION_TEMPLATE_KEY));
  return row?.value.trim() ?? "";
}

/** Upsert the confirmation template name. Empty clears the selection. */
export async function updateWhatsappConfirmationTemplate(
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  await db
    .insert(siteSettings)
    .values({ key: WHATSAPP_CONFIRMATION_TEMPLATE_KEY, value: trimmed })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: trimmed, updatedAt: new Date() },
    });
  return trimmed;
}
