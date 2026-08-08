/**
 * GET /api/admin/checkins
 *
 * The deduplicated check-in log for the dashboard table. Authenticated only —
 * this is the one place attendee details leave the server in bulk, and even
 * here phone numbers and designations are left behind because the table does
 * not show them.
 */

import { requireAdmin } from '../_lib/auth.js';
import { getCheckInLog } from '../_lib/attendance.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, clientKey, fail, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`checkins:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  try {
    const checkIns = await getCheckInLog();
    // Newest first: at a live desk the useful question is who just arrived.
    checkIns.sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)));

    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      checkIns,
      total: checkIns.length,
    });
  } catch (error) {
    return fail(res, error, 'api/admin/checkins');
  }
}
