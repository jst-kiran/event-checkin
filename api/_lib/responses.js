/**
 * Request/response plumbing shared by every serverless function.
 *
 * Files under api/_lib are skipped by Vercel's function detection, so this is
 * a plain module rather than a route.
 *
 * The handlers deliberately speak raw Node `req`/`res`. That is exactly what
 * Vercel hands a Node function, and it is also what the Vite dev plugin hands
 * them locally — one code path, no framework, no adapter to drift.
 */

/** Anything larger than this is refused before it is parsed. */
export const MAX_BODY_BYTES = 8 * 1024;

/**
 * Every status string the API can return. The frontend switches on these, so
 * they are part of the contract; the human wording lives in src/utils/messages.js.
 */
export const STATUS = {
  CHECKED_IN: 'CHECKED_IN',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  LUNCH_APPROVED: 'LUNCH_APPROVED',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  PLEASE_CHECK_IN_FIRST: 'PLEASE_CHECK_IN_FIRST',
  REGISTRATION_NOT_FOUND: 'REGISTRATION_NOT_FOUND',
  OK: 'OK',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHORIZED: 'UNAUTHORIZED',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/** Sends JSON that no CDN or browser may cache. */
export function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

/**
 * Rejects anything that is not one of the expected methods.
 * @returns {boolean} true when the request may continue
 */
export function requireMethod(req, res, ...methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  send(res, 405, { success: false, status: STATUS.METHOD_NOT_ALLOWED });
  return false;
}

/**
 * Reads and parses the JSON body.
 *
 * @returns {Promise<Object|null>} the parsed object, `{}` for an empty body,
 *   or null when the body is malformed or over MAX_BODY_BYTES
 */
export async function readJsonBody(req) {
  // Vercel parses JSON bodies itself; the manual read below covers the dev
  // plugin and any request Vercel left as a raw stream.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

  if (typeof req.body === 'string') {
    if (!req.body.length) return {};
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return null;
    return parseJson(req.body);
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      // Stop reading rather than buffering an unbounded upload.
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(chunk);
    }
  } catch {
    return null;
  }

  if (!chunks.length) return {};
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(raw) {
  try {
    const parsed = JSON.parse(raw);
    // A bare `5` or `"abc"` is valid JSON but never a valid request for us.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Query parameters, parsed the same way in dev and on Vercel. */
export function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const url = new URL(req.url || '/', 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

/**
 * Best-effort client identifier for rate limiting.
 *
 * On Vercel the left-most x-forwarded-for entry is the real client; the header
 * is attacker-controllable in general, so this is used only to spread limits
 * across callers, never for authentication or authorization.
 */
export function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * The last line of defence: logs the real cause server-side and returns a
 * deliberately vague payload.
 *
 * Nothing about the failure — no stack, no Google response, no env var name,
 * no file path — is allowed across the network boundary.
 *
 * @param {*} error the caught error, logged but never serialized to the client
 * @param {string} context route name, so the server log is greppable
 */
export function fail(res, error, context) {
  console.error(`[${context}]`, error instanceof Error ? error.stack || error.message : error);

  // Google being unreachable is a dependency outage (503), not our bug (500).
  const unavailable = error?.name === 'SheetsError' && error.retryable;

  send(res, unavailable ? 503 : 500, {
    success: false,
    status: unavailable ? STATUS.SERVICE_UNAVAILABLE : STATUS.INTERNAL_ERROR,
    message: 'Unable to process request. Please try again.',
  });
}
