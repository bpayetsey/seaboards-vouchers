export type EmailResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

// Pragmatic email shape check: a single @ with a non-empty local part and a
// dotted domain. Deliberately permissive (full RFC 5322 is impractical and
// rejects valid addresses); SendGrid is the ultimate arbiter of deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize a raw email string: trim surrounding whitespace and lowercase it so
 * addresses de-duplicate case-insensitively. Returns a failure reason for blank
 * or malformed input so the importer can record a per-row rejection.
 */
export function normalizeEmail(raw: string): EmailResult {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 320) return { ok: false, reason: "too_long" };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, reason: "invalid" };
  return { ok: true, email: trimmed };
}
