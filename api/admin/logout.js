/**
 * POST /api/admin/logout
 *
 * Clears the session cookie. No authentication is required: the only thing
 * this can do is remove a credential from the caller's own browser, and a
 * logout that fails because the session already expired would be useless.
 *
 * Because the session is stateless there is no server-side record to delete —
 * expiry is carried in the signed payload. The trade-off is documented in the
 * README: a token copied off a device before logout stays valid until `exp`.
 * Rotating SESSION_SECRET invalidates every outstanding session at once.
 */

import { clearSessionCookie } from '../_lib/auth.js';
import { send, requireMethod, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  clearSessionCookie(res);
  return send(res, 200, { success: true, status: STATUS.OK });
}
