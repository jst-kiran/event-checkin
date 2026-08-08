/**
 * GET /api/admin/stats
 *
 * Counts are computed from the live sheets on every call. Nothing is cached
 * across requests, so the dashboard cannot drift away from the spreadsheet an
 * organizer is looking at.
 */

import { requireAdmin } from '../_lib/auth.js';
import { getStats } from '../_lib/attendance.js';
import { getSnapshotInfo } from '../_lib/registrations.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, clientKey, fail, STATUS } from '../_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`stats:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  try {
    const stats = await getStats();
    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      stats,
      // Lets the organizer confirm at a glance that the deployed snapshot is
      // the one they signed off before the event.
      snapshot: getSnapshotInfo(),
    });
  } catch (error) {
    return fail(res, error, 'api/admin/stats');
  }
}
