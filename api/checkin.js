/**
 * POST /api/checkin  { email }
 *
 * The attendee-facing entry point. Everything it returns is either a status
 * the UI knows how to render or a deliberately vague failure — no Google
 * error, no stack, no configuration detail ever reaches the browser.
 */

import { checkInAttendee } from './_lib/attendance.js';
import { publicAttendee } from './_lib/registrations.js';
import { normalizeEmail, isValidEmail } from './_lib/normalize.js';
import { rateLimit, ATTENDEE_LIMIT } from './_lib/rateLimit.js';
import { send, requireMethod, readJsonBody, clientKey, fail, STATUS } from './_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const limit = rateLimit(`checkin:${clientKey(req)}`, ATTENDEE_LIMIT);
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
    // Malformed JSON, or a body over the size cap.
    return send(res, 400, { success: false, status: STATUS.INVALID_REQUEST });
  }

  // The type check is not redundant. normalizeEmail() stringifies whatever it
  // is given — and String(['john@example.com']) is 'john@example.com', so a
  // JSON array would otherwise sail through validation as a valid address.
  if (typeof body.email !== 'string') {
    return send(res, 400, { success: false, status: STATUS.INVALID_EMAIL });
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return send(res, 400, { success: false, status: STATUS.INVALID_EMAIL });
  }

  try {
    const result = await checkInAttendee({ email });

    if (result.status === 'CHECKED_IN') {
      return send(res, 200, {
        success: true,
        status: STATUS.CHECKED_IN,
        attendee: publicAttendee(result.attendee),
      });
    }

    if (result.status === 'ALREADY_CHECKED_IN') {
      // 409: the request was understood and refused because it conflicts with
      // state that already exists.
      return send(res, 409, {
        success: false,
        status: STATUS.ALREADY_CHECKED_IN,
        attendee: publicAttendee(result.attendee),
      });
    }

    // No attendee object here — an unregistered email must not be able to
    // confirm or deny anything about the guest list.
    return send(res, 404, { success: false, status: STATUS.REGISTRATION_NOT_FOUND });
  } catch (error) {
    return fail(res, error, 'api/checkin');
  }
}
