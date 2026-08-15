/**
 * GET/POST /api/admin/project-settings
 *
 * Lets the organizer read and set the project-submission deadline. The value
 * is always IST: the browser sends a plain `<input type="datetime-local">`
 * string with no timezone attached, and api/_lib/settings.js treats that as
 * India Standard Time by construction — see that file's header comment.
 */

import { requireAdmin } from '../_lib/auth.js';
import {
  getProjectSubmissionDeadline,
  setProjectSubmissionDeadline,
  isProjectSubmissionClosed,
  InvalidDeadlineError,
} from '../_lib/settings.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, readJsonBody, clientKey, fail, STATUS } from '../_lib/responses.js';

/** "2026-08-20T18:30:00+05:30" -> "2026-08-20T18:30", the datetime-local shape. */
function toLocalValue(deadline) {
  return deadline ? deadline.slice(0, 16) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { success: false, status: STATUS.METHOD_NOT_ALLOWED });
  }

  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`project-settings:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) {
      return send(res, 400, { success: false, status: STATUS.INVALID_REQUEST });
    }

    const raw = typeof body.deadlineLocal === 'string' ? body.deadlineLocal.trim() : '';

    try {
      const deadline = await setProjectSubmissionDeadline(raw || null);
      return send(res, 200, {
        success: true,
        status: STATUS.OK,
        deadline,
        deadlineLocal: toLocalValue(deadline),
        isClosed: await isProjectSubmissionClosed(),
      });
    } catch (error) {
      if (error instanceof InvalidDeadlineError) {
        return send(res, 400, {
          success: false,
          status: STATUS.INVALID_REQUEST,
          message: error.message,
        });
      }
      return fail(res, error, 'api/admin/project-settings');
    }
  }

  try {
    const deadline = await getProjectSubmissionDeadline();
    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      deadline,
      deadlineLocal: toLocalValue(deadline),
      isClosed: await isProjectSubmissionClosed(),
    });
  } catch (error) {
    return fail(res, error, 'api/admin/project-settings');
  }
}
