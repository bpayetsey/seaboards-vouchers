import crypto from "node:crypto";

// Crockford-style base32 without ambiguous characters (no I, L, O, U, 0, 1) so
// the reference is easy to read aloud and transcribe from an email or receipt.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

function group(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * Generates a human-readable, hard-to-guess order reference such as
 * `SB-7FK3-Q9WX`. With ~30^8 possibilities collisions are negligible; the
 * `order_number` unique constraint is the integrity backstop. Used for both
 * storefront and group orders.
 */
export function newOrderNumber(): string {
  return `SB-${group(4)}-${group(4)}`;
}
