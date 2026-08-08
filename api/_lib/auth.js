/**
 * Admin sessions.
 *
 * Serverless instances come and go, so there is no server-side session store to
 * keep consistent. Instead the browser holds a payload plus an HMAC-SHA256
 * signature over it, in a cookie that JavaScript cannot read. Every protected
 * request re-verifies that signature from scratch.
 *
 * What makes this real authentication rather than the localStorage theatre it
 * replaces: the signing key never leaves the server, so a client can decode the
 * payload but cannot produce a valid signature for one it invented. Editing
 * `sub`, extending `exp`, or inventing a session all fail verification.
 */

import crypto from 'node:crypto';
import { send, STATUS } from './responses.js';

const COOKIE_NAME = 'admin_session';

/** One event day. Long enough to avoid a re-login mid-event. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * The signing key.
 *
 * Deliberately fails closed. Deriving a key from the admin password when
 * SESSION_SECRET is absent would be convenient and would also mean a weak
 * password silently becomes a weak signing key — so a missing secret disables
 * admin login instead.
 */
function signingKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET must be set to at least 16 characters');
  }
  return secret;
}

/** True when the server can actually authenticate an organizer. */
export function isAuthConfigured() {
  try {
    signingKey();
  } catch {
    return false;
  }
  return Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
}

function sign(payload) {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

/** @returns {string} a signed token for `email` */
export function createSessionToken(email) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ sub: email, iat: now, exp: now + SESSION_TTL_SECONDS })
  ).toString('base64url');

  return `${body}.${sign(body)}`;
}

/**
 * @returns {{sub: string, exp: number}|null} null for anything absent,
 *   malformed, re-signed, tampered with, or expired
 */
export function verifySessionToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;

  const dot = token.indexOf('.');
  if (dot < 1 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let expected;
  try {
    expected = sign(body);
  } catch {
    return null; // Not configured — deny rather than accept.
  }

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  // Length is checked first because timingSafeEqual throws on a mismatch.
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!claims || typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
  if (claims.exp < Math.floor(Date.now() / 1000)) return null;

  return claims;
}

/**
 * Constant-time credential check.
 *
 * Both values are hashed before comparison so timingSafeEqual always sees
 * equal-length buffers — comparing raw strings would leak the password length
 * through an exception.
 */
export function verifyCredentials(email, password) {
  const expectedEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const expectedPassword = String(process.env.ADMIN_PASSWORD || '');

  if (!expectedEmail || !expectedPassword) return false;

  const digest = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
  const emailOk = crypto.timingSafeEqual(
    digest(String(email || '').trim().toLowerCase()),
    digest(expectedEmail)
  );
  const passwordOk = crypto.timingSafeEqual(digest(String(password ?? '')), digest(expectedPassword));

  // Both are evaluated before returning, so the answer takes the same work
  // whether it was the email or the password that was wrong.
  return emailOk && passwordOk;
}

/**
 * Browsers refuse a Secure cookie over plain http, which is exactly what
 * localhost is — so Secure is set everywhere except local development.
 */
function isSecureContext() {
  return process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
}

function cookieAttributes() {
  // SameSite=Strict: the admin area is never linked to from another site, so
  // no legitimate flow needs the cookie on a cross-site request. This alone
  // closes CSRF against every state-changing admin route.
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (isSecureContext()) parts.push('Secure');
  return parts;
}

export function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    [`${COOKIE_NAME}=${token}`, ...cookieAttributes(), `Max-Age=${SESSION_TTL_SECONDS}`].join('; ')
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', [`${COOKIE_NAME}=`, ...cookieAttributes(), 'Max-Age=0'].join('; '));
}

function readCookie(req, name) {
  if (req.cookies && typeof req.cookies === 'object' && req.cookies[name]) return req.cookies[name];

  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    } catch {
      return null; // Malformed percent-encoding is not a session.
    }
  }
  return null;
}

/** @returns {{sub: string}|null} the verified session, if any */
export function getSession(req) {
  return verifySessionToken(readCookie(req, COOKIE_NAME));
}

/**
 * The guard on every /api/admin/* route except login.
 *
 * Called by the route itself rather than by middleware: each function is
 * independently deployed, so authorization has to live where the data is
 * served. Writes a 401 and returns null when the caller is not authenticated.
 */
export function requireAdmin(req, res) {
  const session = getSession(req);
  if (session) return session;

  send(res, 401, { success: false, status: STATUS.UNAUTHORIZED });
  return null;
}

export { SESSION_TTL_SECONDS, COOKIE_NAME };
