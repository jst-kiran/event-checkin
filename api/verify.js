/**
 * POST /api/verify  { email }
 *
 * The desk: verify a registration and check the person in.
 *
 *   200 REGISTRATION_VERIFIED          + the five display fields, plus
 *                                      checkIn: { status, checkedInAt, method }
 *                                      where status is CHECKED_IN (just now) or
 *                                      ALREADY_CHECKED_IN (earlier)
 *   404 REGISTRATION_NOT_FOUND         + the exact not-found sentence
 *   409 DUPLICATE_REGISTRATION         the email appears on rows that describe
 *                                      different people; no details, no check-in
 *   503 REGISTRATION_DATA_UNAVAILABLE  the registration sheet could not be read
 *                                      or validated — never reported as "not found"
 *   503 CHECK_IN_UNAVAILABLE           registered, but the check-in could not be
 *                                      saved — the desk is told to try again
 *
 * The registration tab is only read. The check-in is appended to the separate
 * check-in tab (see api/_lib/checkins.js). POST keeps the address out of URLs,
 * browser history and access logs. No Google error, stack, sheet ID or env var
 * name ever reaches the browser.
 */

import { lookupRegistration, publicAttendee } from './_lib/registrations.js';
import { checkIn, METHOD } from './_lib/checkins.js';
import { normalizeEmail, isValidEmail } from './_lib/normalize.js';
import { rateLimit, ATTENDEE_LIMIT } from './_lib/rateLimit.js';
import {
  send,
  requireMethod,
  readJsonBody,
  clientKey,
  STATUS,
  NOT_FOUND_MESSAGE,
} from './_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;

  const limit = rateLimit(`verify:${clientKey(req)}`, ATTENDEE_LIMIT);
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
  if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') {
    return send(res, 400, { success: false, status: STATUS.INVALID_EMAIL });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return send(res, 400, {
      success: false,
      status: STATUS.EMAIL_REQUIRED,
      message: 'Please enter an email address.',
    });
  }
  if (!isValidEmail(email)) {
    return send(res, 400, {
      success: false,
      status: STATUS.INVALID_EMAIL,
      message: 'Please enter a valid email address.',
    });
  }

  let result;
  try {
    result = await lookupRegistration(email);
  } catch (error) {
    // Missing configuration, Google unreachable, permission denied, wrong tab,
    // malformed data: all of them mean "we could not check", which must never
    // be shown to a person at the desk as "you are not registered".
    console.error(
      '[api/verify] registration data unavailable:',
      error instanceof Error ? `${error.name}${error.code ? ` (${error.code})` : ''}: ${error.message}` : error
    );
    return send(res, 503, {
      success: false,
      status: STATUS.REGISTRATION_DATA_UNAVAILABLE,
      message: 'Registration data is temporarily unavailable. Please try again or contact the event organizers.',
    });
  }

  if (result.status === 'FOUND') {
    let outcome;
    try {
      outcome = await checkIn({ email, attendee: result.attendee, method: METHOD.DESK, by: 'Desk' });
    } catch (error) {
      console.error(
        '[api/verify] check-in could not be saved:',
        error instanceof Error ? `${error.name}: ${error.message}` : error
      );
      return send(res, 503, {
        success: false,
        status: STATUS.CHECK_IN_UNAVAILABLE,
        message: 'Registration found, but the check-in could not be saved. Please try again.',
      });
    }

    return send(res, 200, {
      success: true,
      status: STATUS.REGISTRATION_VERIFIED,
      attendee: publicAttendee(result.attendee),
      checkIn: {
        status: outcome.status,
        checkedInAt: outcome.record.checkedInAt || '',
        method: outcome.record.method,
      },
    });
  }

  if (result.status === 'DUPLICATE_CONFLICT') {
    return send(res, 409, {
      success: false,
      status: STATUS.DUPLICATE_REGISTRATION,
      message:
        'More than one registration with different details uses this email. Please contact the event organizers.',
    });
  }

  return send(res, 404, {
    success: false,
    status: STATUS.REGISTRATION_NOT_FOUND,
    message: NOT_FOUND_MESSAGE,
  });
}
