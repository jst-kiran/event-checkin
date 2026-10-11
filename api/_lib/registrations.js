/**
 * Registration data: read live, read-only, from the event's Google Sheet.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE DATA COMES FROM
 * ---------------------------------------------------------------------------
 * The spreadsheet and the tab are named explicitly by two environment
 * variables, REGISTRATION_SHEET_ID and REGISTRATION_SHEET_NAME. There is no
 * default for either and no fallback to any other source — no bundled
 * snapshot, no sample data, no previous event's sheet. If the sheet cannot be
 * read or does not look like a registration list, lookups fail with an error;
 * they never answer "not registered" on the strength of data that did not load.
 *
 * The sheet is read with a short in-memory cache (REGISTRATION_CACHE_SECONDS,
 * 60 s by default) so a busy desk does not spend the Google read quota on
 * every keystroke. A registration added to the sheet is therefore visible
 * within a minute, and nothing older than the TTL is ever served: when a
 * refresh fails, the stale copy is discarded rather than used.
 *
 * ---------------------------------------------------------------------------
 * WHAT LEAVES THIS MODULE
 * ---------------------------------------------------------------------------
 * Only the five fields the verification screen shows. The phone number column
 * is located (so its presence can be reported) but its values are never read
 * into a record, and nothing here can return the list as a whole.
 */

import { googleSheets } from './googleSheets.js';
import { normalizeEmail, isValidEmail, normalizeHeader, text } from './normalize.js';

/* ==========================================================================
 * COLUMN LAYOUT
 * ========================================================================== */

/**
 * The columns the registration form produces, matched by normalized header —
 * so "Enrollment Number ", "enrollment number" and "Enrollment Number"
 * are all the same column, wherever it sits.
 *
 * `required` columns must exist or the sheet is rejected outright. `display`
 * fields are the only values ever returned to a browser.
 */
export const COLUMNS = {
  timestamp: { label: 'Timestamp', aliases: ['timestamp'], required: false },
  fullName: { label: 'Full Name', aliases: ['fullname'], required: true, display: true },
  email: { label: 'E-mail address', aliases: ['emailaddress', 'email'], required: true },
  enrollmentNumber: {
    label: 'Enrollment Number',
    aliases: ['enrollmentnumber', 'enrolmentnumber'],
    required: true,
    display: true,
  },
  semester: { label: 'Semester', aliases: ['semester'], required: true, display: true },
  course: { label: 'Course', aliases: ['course'], required: true, display: true },
  specialization: {
    label: 'Specialization',
    aliases: ['specialization', 'specialisation'],
    required: true,
    display: true,
  },
  // Located for reporting only. Its values are never read.
  phone: { label: 'Phone number', aliases: ['phonenumber'], required: false },
};

/** The fields returned for a verified attendee, in display order. */
export const DISPLAY_FIELDS = Object.keys(COLUMNS).filter((field) => COLUMNS[field].display);

export class RegistrationsError extends Error {
  /**
   * @param {string} message logged server-side only
   * @param {'NOT_CONFIGURED'|'MALFORMED_DATA'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'RegistrationsError';
    this.code = code;
  }
}

/* ==========================================================================
 * CONFIGURATION
 * ========================================================================== */

/**
 * Accepts either a bare spreadsheet ID or a full Google Sheets URL, so the
 * link an organizer copies from the browser can be pasted as-is.
 *
 * @returns {string} the ID, or '' when the value is not recognisable as one
 */
export function parseSpreadsheetId(value) {
  const raw = text(value);
  if (!raw) return '';
  const fromUrl = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(raw);
  const id = fromUrl ? fromUrl[1] : raw;
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : '';
}

/** @returns {{spreadsheetId: string, sheetName: string}} */
export function readRegistrationSource() {
  const rawId = process.env.REGISTRATION_SHEET_ID || '';
  const sheetName = String(process.env.REGISTRATION_SHEET_NAME || '').trim();

  const missing = [];
  if (!rawId.trim()) missing.push('REGISTRATION_SHEET_ID');
  if (!sheetName) missing.push('REGISTRATION_SHEET_NAME');
  if (missing.length) {
    throw new RegistrationsError(
      `Registration source is not configured. Missing: ${missing.join(', ')}`,
      'NOT_CONFIGURED'
    );
  }

  const spreadsheetId = parseSpreadsheetId(rawId);
  if (!spreadsheetId) {
    throw new RegistrationsError(
      'REGISTRATION_SHEET_ID is not a spreadsheet ID or Google Sheets URL',
      'NOT_CONFIGURED'
    );
  }

  return { spreadsheetId, sheetName };
}

/** 60 s unless REGISTRATION_CACHE_SECONDS says otherwise (0–600). */
export function cacheTtlMs() {
  const raw = process.env.REGISTRATION_CACHE_SECONDS;
  if (raw === undefined || raw === '') return 60_000;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 600 ? seconds * 1000 : 60_000;
}

/* ==========================================================================
 * PARSING
 * ========================================================================== */

/**
 * Resolves each field to exactly one column.
 *
 * Two columns that both look like the same field (a Google Form that collects
 * the respondent's address *and* asks for one, say) are refused rather than
 * guessed between: picking the wrong one would verify the wrong people.
 */
export function resolveColumns(headerRow) {
  const headers = (headerRow || []).map(text);
  const normalized = headers.map(normalizeHeader);
  const columns = {};

  for (const [field, spec] of Object.entries(COLUMNS)) {
    const matches = [];
    normalized.forEach((value, index) => {
      if (value && spec.aliases.includes(value)) matches.push(index);
    });

    if (matches.length > 1) {
      throw new RegistrationsError(
        `Ambiguous columns for "${spec.label}": ${matches.map((i) => `"${headers[i]}"`).join(', ')}`,
        'MALFORMED_DATA'
      );
    }
    if (matches.length === 1) columns[field] = { index: matches[0], header: headers[matches[0]] };
  }

  const missing = Object.entries(COLUMNS)
    .filter(([field, spec]) => spec.required && !columns[field])
    .map(([, spec]) => spec.label);

  if (missing.length) {
    throw new RegistrationsError(
      `Required column(s) not found: ${missing.join(', ')}. Headers seen: ${headers.join(' | ')}`,
      'MALFORMED_DATA'
    );
  }

  return { headers, columns };
}

function cell(row, column) {
  return column ? text(row?.[column.index]) : '';
}

/** Case- and spacing-insensitive equality for duplicate comparison. */
function sameValue(a, b) {
  return text(a).toLowerCase() === text(b).toLowerCase();
}

/**
 * Identity comparison: letters and digits only, so "A. Kumar" and "a kumar",
 * or "2210 3456" and "22103456", are the same.
 */
function sameIdentity(a, b) {
  return normalizeHeader(a) === normalizeHeader(b);
}

/** The fields that say WHO someone is. Everything else is descriptive. */
const IDENTITY_FIELDS = ['fullName', 'enrollmentNumber'];

/** Distinct values in sheet order, case-insensitively, joined for display. */
function combinedValue(values) {
  const seen = new Map();
  for (const value of values) {
    const key = text(value).toLowerCase();
    if (key && !seen.has(key)) seen.set(key, text(value));
  }
  return [...seen.values()].join(' / ');
}

/**
 * Turns the raw tab into an email index plus a report.
 *
 * Pure — no I/O — so the exact logic that runs in production can be run
 * against fixtures in tests and against the real sheet by the check script.
 *
 * Rules:
 *   - a row with no email, or an address that is not an email, is rejected
 *     (it could never be looked up) and reported by row number;
 *   - a row with a valid email but a blank detail field is still a
 *     registration — the person did register — and is reported as incomplete;
 *   - the same email on several rows with identical details is one person who
 *     submitted twice, and collapses to one record;
 *   - the same email on several rows with the same Full Name and Enrollment
 *     Number, but differently worded Semester / Course / Specialization, is
 *     still unmistakably one person. No row is picked: every distinct value is
 *     shown ("ECE / Btech ECE"), so the desk sees exactly what the sheet says;
 *   - the same email on rows whose Full Name or Enrollment Number DIFFER may
 *     be two different people. That is a conflict: no row is picked, a lookup
 *     reports the conflict and returns no details at all.
 *
 * The report holds row numbers and counts only — never names or emails.
 *
 * @param {Array<Array<*>>} rows header row first, as returned by Sheets
 */
export function buildRegistrationIndex(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RegistrationsError('The registration tab is empty (no header row)', 'MALFORMED_DATA');
  }

  const { headers, columns } = resolveColumns(rows[0]);

  const groups = new Map(); // email -> [{ rowNumber, attendee }]
  const report = {
    dataRows: 0,
    blankRows: 0,
    rejected: [], // { rowNumber, reason }
    incomplete: [], // { rowNumber, fields }
    repeatSubmissions: [], // { rowNumbers } — identical rows, collapsed
    combinedVariants: [], // { rowNumbers, differingFields } — same person, details combined
    conflicts: [], // { rowNumbers, differingFields } — identity differs, blocked
  };

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // 1-based, header included — as shown in Google Sheets

    if (!Array.isArray(row) || row.every((value) => text(value) === '')) {
      report.blankRows++;
      continue;
    }
    report.dataRows++;

    const email = normalizeEmail(cell(row, columns.email));
    if (!email) {
      report.rejected.push({ rowNumber, reason: 'missing email' });
      continue;
    }
    if (!isValidEmail(email)) {
      report.rejected.push({ rowNumber, reason: 'invalid email format' });
      continue;
    }

    const attendee = {};
    for (const field of DISPLAY_FIELDS) attendee[field] = cell(row, columns[field]);

    const blank = DISPLAY_FIELDS.filter((field) => !attendee[field]).map((f) => COLUMNS[f].label);
    if (blank.length) report.incomplete.push({ rowNumber, fields: blank });

    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push({ rowNumber, attendee: Object.freeze(attendee) });
  }

  const byEmail = new Map();
  for (const [email, entries] of groups) {
    const rowNumbers = entries.map((entry) => entry.rowNumber);

    if (entries.length === 1) {
      byEmail.set(email, { attendee: entries[0].attendee, rowNumbers });
      continue;
    }

    const first = entries[0].attendee;
    const differing = DISPLAY_FIELDS.filter((field) =>
      entries.some((entry) => !sameValue(entry.attendee[field], first[field]))
    );
    const differingFields = differing.map((field) => COLUMNS[field].label);

    if (differing.length === 0) {
      report.repeatSubmissions.push({ rowNumbers });
      byEmail.set(email, { attendee: first, rowNumbers });
      continue;
    }

    const identityAgrees = IDENTITY_FIELDS.every((field) =>
      entries.every((entry) => sameIdentity(entry.attendee[field], first[field]))
    );

    if (identityAgrees) {
      const attendee = {};
      for (const field of DISPLAY_FIELDS) {
        attendee[field] = combinedValue(entries.map((entry) => entry.attendee[field]));
      }
      report.combinedVariants.push({ rowNumbers, differingFields });
      byEmail.set(email, { attendee: Object.freeze(attendee), rowNumbers });
    } else {
      report.conflicts.push({ rowNumbers, differingFields });
      byEmail.set(email, { conflict: true, rowNumbers });
    }
  }

  const verifiable = [...byEmail.values()].filter((entry) => !entry.conflict).length;

  // A tab where nothing — or mostly nothing — parses is the wrong tab or a
  // broken export, not an event nobody registered for. Refusing it here is
  // what stops a configuration mistake from telling every attendee at the
  // door that they are not registered.
  if (verifiable === 0) {
    throw new RegistrationsError('No valid registrations found in the registration tab', 'MALFORMED_DATA');
  }
  if (report.rejected.length > report.dataRows / 2) {
    throw new RegistrationsError(
      `${report.rejected.length} of ${report.dataRows} rows have no valid email — refusing to use this data`,
      'MALFORMED_DATA'
    );
  }

  return {
    byEmail,
    headers,
    columns,
    report: {
      ...report,
      uniqueEmails: byEmail.size,
      verifiableRegistrations: verifiable,
      missingOptionalColumns: Object.entries(COLUMNS)
        .filter(([field, spec]) => !spec.required && !columns[field])
        .map(([, spec]) => spec.label),
    },
  };
}

/* ==========================================================================
 * LOADING (cached, read-only)
 * ========================================================================== */

let cache = null; // { key, at, index }
let inflight = null; // { key, promise }

/**
 * The parsed registration index, at most cacheTtlMs() old.
 *
 * Concurrent callers in one instance share a single Google read. A failed read
 * is never cached and never falls back to an expired copy.
 *
 * @param {{sheets?: {getSheetValues: Function}}} [options] `sheets` is the
 *   read port — a fake in tests
 */
export async function loadRegistrationIndex({ sheets = googleSheets } = {}) {
  const source = readRegistrationSource();
  const key = `${source.spreadsheetId}\u0000${source.sheetName}`;

  if (cache && cache.key === key && Date.now() - cache.at < cacheTtlMs()) return cache.index;
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = (async () => {
    const rows = await sheets.getSheetValues(source.spreadsheetId, source.sheetName);
    const index = buildRegistrationIndex(rows);
    cache = { key, at: Date.now(), index };
    return index;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

/**
 * Looks one email up.
 *
 * @returns {Promise<{status: 'FOUND', attendee: Object} | {status: 'NOT_FOUND'} |
 *   {status: 'DUPLICATE_CONFLICT'}>}
 * @throws {RegistrationsError|SheetsError} when the data could not be loaded —
 *   callers must report that as an outage, never as "not found"
 */
export async function lookupRegistration(rawEmail, options) {
  const email = normalizeEmail(rawEmail);
  const index = await loadRegistrationIndex(options);
  const entry = email ? index.byEmail.get(email) : undefined;

  if (!entry) return { status: 'NOT_FOUND' };
  if (entry.conflict) return { status: 'DUPLICATE_CONFLICT' };
  return { status: 'FOUND', attendee: entry.attendee };
}

/**
 * The only shape of attendee data that may cross the network: the five
 * display fields, explicitly copied. No email, no phone, no row number.
 */
export function publicAttendee(attendee) {
  if (!attendee) return null;
  return {
    fullName: attendee.fullName || '',
    enrollmentNumber: attendee.enrollmentNumber || '',
    semester: attendee.semester || '',
    course: attendee.course || '',
    specialization: attendee.specialization || '',
  };
}

/** Test-only: forgets the cached index. */
export function __resetRegistrationCache() {
  cache = null;
  inflight = null;
}
