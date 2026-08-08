/**
 * POST /api/lunch  { email }
 *
 * Lunch requires a prior check-in, and the meal preference comes from the
 * frozen registration — the request body carries an email and nothing else, so
 * there is no field an attendee could use to change their own meal.
 */

import { claimLunch } from './_lib/attendance.js';
import { publicAttendee } from './_lib/registrations.js';
import { normalizeEmail, isValidEmail } from './_lib/normalize.js';
import { rateLimit, ATTENDEE_LIMIT } from './_lib/rateLimit.js';
import { send, requireMethod, readJsonBody, clientKey, fail, STATUS } from './_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const limit = rateLimit(`lunch:${clientKey(req)}`, ATTENDEE_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, {
      success: false,
      status: STATUS.RATE_LIMITED,
      message: 'Too many attempts. Please wait a moment and try again.',
    });
  }

  const body = await readJsonBody(req);
  if (!body) {
    return send(res, 400, { success: false, status: STATUS.INVALID_REQUEST });
  }

  // See the note in checkin.js: String(['a@b.com']) === 'a@b.com', so a
  // non-string body field has to be refused before it is normalized.
  if (typeof body.email !== 'string') {
    return send(res, 400, { success: false, status: STATUS.INVALID_EMAIL });
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return send(res, 400, { success: false, status: STATUS.INVALID_EMAIL });
  }

  try {
    const result = await claimLunch({ email });

    if (result.status === 'LUNCH_APPROVED') {
      return send(res, 200, {
        success: true,
        status: STATUS.LUNCH_APPROVED,
        attendee: publicAttendee(result.attendee),
      });
    }

    if (result.status === 'ALREADY_CLAIMED') {
      return send(res, 409, {
        success: false,
        status: STATUS.ALREADY_CLAIMED,
        attendee: publicAttendee(result.attendee),
      });
    }

    if (result.status === 'PLEASE_CHECK_IN_FIRST') {
      // 403: registered, but not entitled to lunch until they check in.
      return send(res, 403, {
        success: false,
        status: STATUS.PLEASE_CHECK_IN_FIRST,
        attendee: publicAttendee(result.attendee),
      });
    }

    return send(res, 404, { success: false, status: STATUS.REGISTRATION_NOT_FOUND });
  } catch (error) {
    return fail(res, error, 'api/lunch');
  }
}
