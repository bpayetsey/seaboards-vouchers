import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export interface NormalizedPhone {
  /** E.164 string, e.g. +2482510000. */
  e164: string;
}

export type PhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: string };

/**
 * Normalize a raw phone string to E.164. A `defaultCountry` (ISO 3166-1
 * alpha-2, e.g. "SC") is used for local-format numbers that omit a country
 * code; numbers already written with a leading "+" ignore it.
 */
export function normalizePhone(
  raw: string,
  defaultCountry?: string,
): PhoneResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const country =
    defaultCountry && /^[A-Za-z]{2}$/.test(defaultCountry)
      ? (defaultCountry.toUpperCase() as CountryCode)
      : undefined;

  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed) return { ok: false, reason: "unparseable" };
  if (!parsed.isValid()) return { ok: false, reason: "invalid" };

  return { ok: true, e164: parsed.number };
}
