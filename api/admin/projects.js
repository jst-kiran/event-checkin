/**
 * GET /api/admin/projects
 *
 * Project submissions for the admin dashboard. Authenticated, like every other
 * admin read — a Drive link to a team's work is not public information.
 */

import { requireAdmin } from '../_lib/auth.js';
import { getProjectUploads } from '../_lib/projects.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, clientKey, fail, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`projects:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  try {
    const { submissions } = await getProjectUploads();
    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      submissions,
      total: submissions.length,
    });
  } catch (error) {
    return fail(res, error, 'api/admin/projects');
  }
}
