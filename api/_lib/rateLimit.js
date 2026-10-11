/**
 * Lightweight abuse protection for publicly reachable endpoints.
 *
 * A fixed window counter held in the lambda's memory. Be clear about what that
 * does and does not buy:
 *
 *   IT DOES stop the cheap attacks this system actually faces — someone
 *   holding down a button, a script hammering /api/verify from one machine, or
 *   a burst of login guesses — and it protects the Google Sheets read quota,
 *   which is the resource that would actually take the desk down.
 *
 *   IT DOES NOT survive a cold start, and it is not shared between concurrent
 *   instances, so a distributed attacker gets a multiple of these limits.
 *
 * The alternative is Redis or a database, which requirement 33 rules out for
 * good reason: an event desk should not gain a new hard dependency, and a new
 * single point of failure, in exchange for a limit nobody is testing.
 */

const buckets = new Map();

/** Stops the map growing without bound over a long-running instance. */
const MAX_TRACKED_KEYS = 5000;

/**
 * @param {string} key caller identity, usually IP plus a route prefix
 * @param {{limit: number, windowMs: number}} options
 * @returns {{allowed: boolean, retryAfterSeconds: number}}
 */
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count++;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  // Still full of live windows: drop the oldest rather than refuse to track.
  if (buckets.size >= MAX_TRACKED_KEYS) {
    const oldest = [...buckets.keys()].slice(0, Math.floor(MAX_TRACKED_KEYS / 4));
    for (const key of oldest) buckets.delete(key);
  }
}

/**
 * Generous enough that a desk operator working fast is never blocked, tight
 * enough that a script cannot burn the Sheets quota.
 */
export const ATTENDEE_LIMIT = { limit: 30, windowMs: 60_000 };

/** Deliberately strict: password guessing is the one attack worth throttling hard. */
export const LOGIN_LIMIT = { limit: 8, windowMs: 15 * 60_000 };

/** Guards against a dashboard left on a refresh loop. */
export const ADMIN_READ_LIMIT = { limit: 120, windowMs: 60_000 };

/** Test-only. */
export function __resetRateLimits() {
  buckets.clear();
}
