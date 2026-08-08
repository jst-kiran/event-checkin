/**
 * POST /api/admin/login  { email, password }
 *
 * The credentials are compared against environment variables that exist only
 * on the server. Success sets an HttpOnly signed cookie; the browser is never
 * told the password, the signing key, or which of the two fields was wrong.
 */

import {
  verifyCredentials,
  createSessionToken,
  setSessionCookie,
  isAuthConfigured,
} from '../_lib/auth.js';
import { rateLimit, LOGIN_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, readJsonBody, clientKey, fail, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const limit = rateLimit(`login:${clientKey(req)}`, LOGIN_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, {
      success: false,
      status: STATUS.RATE_LIMITED,
      message: 'Too many sign-in attempts. Please wait and try again.',
    });
  }

  if (!isAuthConfigured()) {
    // A deployment missing ADMIN_* or SESSION_SECRET must refuse to sign
    // anyone in rather than fall back to a weaker check.
    console.error('[api/admin/login] ADMIN_EMAIL, ADMIN_PASSWORD or SESSION_SECRET is not set');
    return send(res, 503, {
      success: false,
      status: STATUS.NOT_CONFIGURED,
      message: 'Admin sign-in is not configured on the server.',
    });
  }

  const body = await readJsonBody(req);
  if (!body) return send(res, 400, { success: false, status: STATUS.INVALID_REQUEST });

  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return send(res, 400, {
      success: false,
      status: STATUS.INVALID_REQUEST,
      message: 'Email and password are required.',
    });
  }

  // Cap before hashing so an oversized field cannot become work for us.
  if (email.length > 254 || password.length > 512) {
    return send(res, 400, { success: false, status: STATUS.INVALID_REQUEST });
  }

  try {
    if (!verifyCredentials(email, password)) {
      // One message for both failure modes: revealing that an email exists
      // would turn this into an account oracle.
      return send(res, 401, { success: false, status: STATUS.INVALID_CREDENTIALS });
    }

    setSessionCookie(res, createSessionToken(email.trim().toLowerCase()));
    return send(res, 200, { success: true, status: STATUS.OK });
  } catch (error) {
    return fail(res, error, 'api/admin/login');
  }
}
