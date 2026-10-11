/**
 * /api/admin/attendees — the organizer dashboard's data and actions.
 * Every method requires a signed-in organizer.
 *
 * GET
 *   Every registration in the sheet, each with its check-in status, time and
 *   method, plus walk-ins (checked in but not registered), summary counts and
 *   sheet health (rejected rows, duplicates — by row number). Phone numbers are
 *   never included.
 *
 * POST { action: "check-in", email }
 *   Manually checks in someone who is in the registration sheet.
 *
 * POST { action: "walk-in", fullName, email, enrollmentNumber?, semester?,
 *        course?, specialization? }
 *   Checks in someone who is NOT in the registration sheet.
 *
 * Both actions append to the check-in tab only; the registration tab is never
 * written (see api/_lib/googleSheets.js). Manual check-ins and walk-ins are
 * recorded with their method so they are highlighted on the dashboard and in
 * the spreadsheet.
 */

import { requireAdmin } from '../_lib/auth.js';
import { loadRegistrationIndex, readRegistrationSource } from '../_lib/registrations.js';
import { checkIn, getCheckIns, METHOD } from '../_lib/checkins.js';
import { normalizeEmail, isValidEmail, text } from '../_lib/normalize.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, readJsonBody, clientKey, STATUS } from '../_lib/responses.js';

const MAX_FIELD_LENGTH = 120;
const DETAIL_FIELDS = ['fullName', 'enrollmentNumber', 'semester', 'course', 'specialization'];

function logCause(context, error) {
  console.error(`[api/admin/attendees] ${context}:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
}

const unavailable = (res) =>
  send(res, 503, {
    success: false,
    status: STATUS.REGISTRATION_DATA_UNAVAILABLE,
    message: 'Registration data could not be loaded. Please try again.',
  });

const checkInUnavailable = (res) =>
  send(res, 503, {
    success: false,
    status: STATUS.CHECK_IN_UNAVAILABLE,
    message: 'The check-in could not be saved. Please try again.',
  });

/** What the dashboard is told about one check-in row. */
function checkInView(record) {
  return {
    checkedIn: Boolean(record),
    checkedInAt: record?.checkedInAt || '',
    method: record?.method || '',
    checkedInBy: record?.checkedInBy || '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { success: false, status: STATUS.METHOD_NOT_ALLOWED });
  }

  const session = requireAdmin(req, res);
  if (!session) return;

  const limit = rateLimit(`admin-attendees:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  return req.method === 'GET' ? list(res) : act(req, res, session);
}

/* ==========================================================================
 * GET — the list
 * ========================================================================== */

async function list(res) {
  let index;
  try {
    index = await loadRegistrationIndex();
  } catch (error) {
    logCause('registration data unavailable', error);
    return unavailable(res);
  }

  let checkIns;
  try {
    checkIns = await getCheckIns();
  } catch (error) {
    logCause('check-in tab unavailable', error);
    return send(res, 503, {
      success: false,
      status: STATUS.SERVICE_UNAVAILABLE,
      message: 'Check-in data could not be loaded. Please try again.',
    });
  }

  const attendees = [];
  for (const [email, entry] of index.byEmail) {
    const record = checkIns.byEmail.get(email);
    const details = entry.attendee || {};
    attendees.push({
      email,
      rowNumbers: entry.rowNumbers,
      conflict: Boolean(entry.conflict),
      walkIn: false,
      ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field, details[field] || ''])),
      ...checkInView(record),
    });
  }
  attendees.sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0]);

  const walkIns = [];
  for (const [email, record] of checkIns.byEmail) {
    if (index.byEmail.has(email)) continue;
    walkIns.push({
      email,
      rowNumbers: [],
      conflict: false,
      walkIn: true,
      ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field, record[field] || ''])),
      ...checkInView(record),
    });
  }
  walkIns.sort((a, b) => String(a.checkedInAt).localeCompare(String(b.checkedInAt)));

  const checkedIn = attendees.filter((a) => a.checkedIn);
  const { report } = index;

  return send(res, 200, {
    success: true,
    status: STATUS.OK,
    summary: {
      totalRegistrations: attendees.length,
      checkedIn: checkedIn.length,
      notCheckedIn: attendees.length - checkedIn.length,
      deskCheckIns: checkedIn.filter((a) => a.method === METHOD.DESK).length,
      manualCheckIns: checkedIn.filter((a) => a.method !== METHOD.DESK).length,
      walkIns: walkIns.length,
      totalPresent: checkedIn.length + walkIns.length,
    },
    attendees,
    walkIns,
    sheet: {
      registrationTab: readRegistrationSource().sheetName,
      checkInTab: checkIns.sheetName,
      checkInTabExists: checkIns.exists,
      dataRows: report.dataRows,
      rejectedRows: report.rejected,
      repeatSubmissions: report.repeatSubmissions.length,
      combinedVariants: report.combinedVariants,
      conflicts: report.conflicts,
    },
    generatedAt: new Date().toISOString(),
  });
}

/* ==========================================================================
 * POST — manual check-in and walk-in
 * ========================================================================== */

function badRequest(res, message, status = STATUS.INVALID_REQUEST) {
  return send(res, 400, { success: false, status, message });
}

async function act(req, res, session) {
  const body = await readJsonBody(req);
  if (!body) return badRequest(res, 'Invalid request.');

  const action = body.action;
  if (action !== 'check-in' && action !== 'walk-in') {
    return badRequest(res, 'Unknown action.');
  }
  if (typeof body.email !== 'string') return badRequest(res, 'Please enter a valid email address.', STATUS.INVALID_EMAIL);

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return badRequest(res, 'Please enter a valid email address.', STATUS.INVALID_EMAIL);

  let index;
  try {
    index = await loadRegistrationIndex();
  } catch (error) {
    logCause('registration data unavailable', error);
    return unavailable(res);
  }

  const entry = index.byEmail.get(email);
  let method;
  let attendee;

  if (action === 'check-in') {
    if (!entry) {
      return send(res, 404, {
        success: false,
        status: STATUS.REGISTRATION_NOT_FOUND,
        message: 'This email is not in the registration sheet. Add the person as a walk-in instead.',
      });
    }
    method = METHOD.MANUAL;
    attendee = entry.attendee || {};
  } else {
    if (entry) {
      return send(res, 409, {
        success: false,
        status: STATUS.ALREADY_REGISTERED,
        message: 'This email is already registered. Use "Check in" on their row instead.',
      });
    }

    attendee = {};
    for (const field of DETAIL_FIELDS) {
      const value = body[field] === undefined || body[field] === null ? '' : body[field];
      if (typeof value !== 'string') return badRequest(res, 'Invalid walk-in details.');
      const clean = text(value);
      if (clean.length > MAX_FIELD_LENGTH) return badRequest(res, 'One of the fields is too long.');
      attendee[field] = clean;
    }
    if (!attendee.fullName) return badRequest(res, 'Full Name is required for a walk-in.');
    method = METHOD.WALK_IN;
  }

  let outcome;
  try {
    outcome = await checkIn({ email, attendee, method, by: session.sub });
  } catch (error) {
    logCause('check-in could not be saved', error);
    return checkInUnavailable(res);
  }

  const { record } = outcome;
  return send(res, 200, {
    success: true,
    status: outcome.status,
    attendee: {
      email,
      ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field, record[field] || attendee[field] || ''])),
      ...checkInView(record),
    },
  });
}
