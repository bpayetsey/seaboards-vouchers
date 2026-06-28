/**
 * Tiny in-memory fixed-window rate limiter. Suitable for low-frequency,
 * single-instance protections (e.g. throttling self-service voucher resends so
 * an account can't be used to spam an address). Not a distributed limiter —
 * state is per-process and resets on restart.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry, when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Records an attempt for `key` and reports whether it is within `limit`
 * attempts per `windowMs`. Each call counts as one attempt when allowed.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const existing = windows.get(key);
  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
