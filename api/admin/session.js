/**
 * GET /api/admin/session
 *
 * Answers "is this browser signed in?" so the router can send an
 * unauthenticated visitor to the login page instead of flashing an empty
 * dashboard at them.
 *
 * This is a convenience for rendering, not a security boundary. Every route
 * that returns real data enforces requireAdmin() for itself, so a client that
 * lies about the answer still gets nothing.
 */

import { getSession } from '../_lib/auth.js';
import { send, requireMethod, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;

  const session = getSession(req);
  if (!session) return send(res, 401, { success: false, status: STATUS.UNAUTHORIZED });

  return send(res, 200, {
    success: true,
    status: STATUS.OK,
    // The signed-in identity, which the browser already supplied at login.
    email: session.sub,
    expiresAt: session.exp,
  });
}
