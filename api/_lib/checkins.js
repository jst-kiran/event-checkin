/**
 * Check-ins: the only data this application writes.
 *
 * They live in their own tab — CHECKIN_SHEET_NAME, "CheckIns" by default —
 * inside the registration spreadsheet. The registration tab is read, never
 * written; googleSheets.js refuses any write that is not aimed at this tab.
 *
 * One row per check-in:
 *
 *   Timestamp | E-mail address | Full Name | Enrollment Number | Semester |
 *   Course | Specialization | Method | Checked In By | Status
 *
 * Method is how the person was checked in:
 *   - "Desk"     verified on the /checkin screen
 *   - "Manual"   an organizer pressed "Check in" on the dashboard (or typed the
 *                row into the tab by hand — any row without a recognised
 *                method is treated as manual)
 *   - "Walk-in"  an organizer added someone who is not in the registration sheet
 *
 * Manual and walk-in rows are highlighted, both on the dashboard and in the
 * spreadsheet itself (conditional formatting added when the tab is created).
 *
 * ---------------------------------------------------------------------------
 * DUPLICATES
 * ---------------------------------------------------------------------------
 * Google Sheets has no transactions, so two devices checking in the same
 * person at the same moment could both append. That is made harmless the same
 * way the previous event's desk did it:
 *
 *   1. Requests for the same email are queued inside one server instance.
 *   2. After appending, the tab is re-read; the lowest row number for an email
 *      wins, and a losing row marks itself "Duplicate (ignored)". Both racers
 *      apply the same rule to the same data, so exactly one row survives.
 *   3. Every read skips ignored rows and counts each email once.
 *
 * Nothing is ever deleted.
 */

import { googleSheets, checkInSheetName, isMissingSheetError, columnLetter, SheetsError } from './googleSheets.js';
import { normalizeEmail, normalizeHeader, text } from './normalize.js';
import { formatTimestamp } from './time.js';
import { readRegistrationSource } from './registrations.js';

export const METHOD = Object.freeze({ DESK: 'Desk', MANUAL: 'Manual', WALK_IN: 'Walk-in' });
export const CHECKED_IN_STATUS = 'Checked In';
export const IGNORED_STATUS = 'Duplicate (ignored)';

/** Layout used when this application creates the tab. */
export const CHECKIN_HEADERS = [
  'Timestamp',
  'E-mail address',
  'Full Name',
  'Enrollment Number',
  'Semester',
  'Course',
  'Specialization',
  'Method',
  'Checked In By',
  'Status',
];

/** Row colours in the spreadsheet. The first matching rule wins. */
const SHEET_HIGHLIGHTS = [
  { column: 9, equals: IGNORED_STATUS, color: '#F1F5F9' }, // grey: ignored duplicate
  { column: 7, equals: METHOD.MANUAL, color: '#FEF3C7' }, // amber: manual check-in
  { column: 7, equals: METHOD.WALK_IN, color: '#EDE9FE' }, // purple: walk-in
];

/** Header spellings accepted when reading, so a hand-made tab still works. */
const FIELD_ALIASES = {
  timestamp: ['timestamp', 'checkedinat', 'checkintime'],
  email: ['emailaddress', 'email'],
  fullName: ['fullname', 'name'],
  enrollmentNumber: ['enrollmentnumber', 'enrolmentnumber'],
  semester: ['semester'],
  course: ['course'],
  specialization: ['specialization', 'specialisation'],
  method: ['method', 'checkinmethod'],
  checkedInBy: ['checkedinby', 'by'],
  status: ['status', 'checkinstatus'],
};

/**
 * Within a request burst, the "already checked in?" pre-check may use a copy
 * this young. A stale copy can only be missing recent rows — never invent one —
 * and the reconciliation pass after every append always reads fresh.
 */
const READ_CACHE_TTL_MS = 3000;

/** The dashboard polls; this keeps several open dashboards to one read per window. */
export const ADMIN_CACHE_TTL_MS = 5000;

const readCache = new Map();

function mapHeaders(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const index = normalized.findIndex((value) => value && aliases.includes(value));
    if (index !== -1) map[field] = index;
  }
  return map;
}

/** "walk in", "WALK-IN" -> "Walk-in"; blank or unknown -> "Manual". */
function canonicalMethod(value) {
  const key = normalizeHeader(value);
  if (key === 'desk') return METHOD.DESK;
  if (key === 'walkin') return METHOD.WALK_IN;
  return METHOD.MANUAL;
}

function where() {
  const { spreadsheetId } = readRegistrationSource();
  return { spreadsheetId, sheetName: checkInSheetName() };
}

/**
 * Reads the check-in tab. A tab that does not exist yet simply has no
 * check-ins — it is created on the first write.
 */
async function readSheet(sheets, { maxAgeMs = READ_CACHE_TTL_MS } = {}) {
  const { spreadsheetId, sheetName } = where();
  const key = `${spreadsheetId}\u0000${sheetName}`;
  const cached = readCache.get(key);
  if (maxAgeMs > 0 && cached && Date.now() - cached.at < maxAgeMs) return cached.value;

  let rows;
  let exists = true;
  try {
    rows = await sheets.getSheetValues(spreadsheetId, sheetName);
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;
    rows = [];
    exists = false;
  }

  const headers = rows.length ? rows[0].map(text) : [];
  const map = mapHeaders(headers);
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cell = (field) => (map[field] === undefined ? '' : text(row[map[field]]));
    const email = normalizeEmail(cell('email'));
    if (!email) continue;

    const status = cell('status');
    records.push({
      email,
      fullName: cell('fullName'),
      enrollmentNumber: cell('enrollmentNumber'),
      semester: cell('semester'),
      course: cell('course'),
      specialization: cell('specialization'),
      method: canonicalMethod(cell('method')),
      checkedInBy: cell('checkedInBy'),
      checkedInAt: cell('timestamp'),
      ignored: status === IGNORED_STATUS,
      rowNumber: i + 1,
    });
  }

  const value = { exists, headers, map, records, spreadsheetId, sheetName };
  readCache.set(key, { at: Date.now(), value });
  return value;
}

function invalidate(sheet) {
  readCache.delete(`${sheet.spreadsheetId}\u0000${sheet.sheetName}`);
}

const activeRecords = (sheet) => sheet.records.filter((record) => !record.ignored);
const findActive = (sheet, email) => activeRecords(sheet).find((record) => record.email === email) || null;

/** Creates the tab, or writes a header into an empty one, then re-reads it. */
async function ensureTab(sheets) {
  let sheet = await readSheet(sheets);
  if (sheet.exists && sheet.map.email !== undefined) return sheet;

  if (!sheet.exists) {
    await sheets.createCheckInTab(sheet.spreadsheetId, sheet.sheetName, {
      headers: CHECKIN_HEADERS,
      highlights: SHEET_HIGHLIGHTS,
    });
  } else if (!sheet.headers.length) {
    const last = columnLetter(CHECKIN_HEADERS.length - 1);
    await sheets.updateSheetValues(sheet.spreadsheetId, sheet.sheetName, `A1:${last}1`, [CHECKIN_HEADERS]);
  } else {
    // Populated, but nothing reads as an email column: appending here would
    // scatter data into the wrong columns.
    throw new SheetsError(`The "${sheet.sheetName}" tab has no E-mail address column`);
  }

  invalidate(sheet);
  sheet = await readSheet(sheets, { maxAgeMs: 0 });
  if (sheet.map.email === undefined) {
    throw new SheetsError(`The "${sheet.sheetName}" tab could not be prepared`);
  }
  return sheet;
}

/** Lays values out according to the tab's actual header positions. */
function buildRow(map, width, fields) {
  const row = new Array(width).fill('');
  for (const [field, value] of Object.entries(fields)) {
    const index = map[field];
    if (index !== undefined && index < width) row[index] = value;
  }
  return row;
}

/* ==========================================================================
 * CONCURRENCY
 * ========================================================================== */

const inFlight = new Map();

/** One queue per email: different people run in parallel, one person never does. */
function withEmailLock(email, task) {
  const previous = inFlight.get(email) || Promise.resolve();
  const result = previous.then(() => task());
  const settled = result.then(
    () => {},
    () => {}
  );
  inFlight.set(email, settled);
  settled.then(() => {
    if (inFlight.get(email) === settled) inFlight.delete(email);
  });
  return result;
}

/**
 * Lowest row number for an email wins. The loser marks its own row ignored.
 * @returns {Promise<Object|null>} the winning record, or null if ours won
 */
async function reconcile(sheets, sheet, email, myRowNumber) {
  if (!myRowNumber) return null;

  const fresh = await readSheet(sheets, { maxAgeMs: 0 });
  const rivals = activeRecords(fresh).filter((record) => record.email === email);
  if (rivals.length <= 1) return null;

  const winner = rivals.reduce((a, b) => (a.rowNumber <= b.rowNumber ? a : b));
  if (winner.rowNumber === myRowNumber) return null;

  if (fresh.map.status !== undefined) {
    await sheets.updateSheetValues(fresh.spreadsheetId, fresh.sheetName, `${columnLetter(fresh.map.status)}${myRowNumber}`, [
      [IGNORED_STATUS],
    ]);
    invalidate(fresh);
  }
  return winner;
}

/* ==========================================================================
 * PUBLIC API
 * ========================================================================== */

/**
 * Records a check-in, once per email.
 *
 * @param {{email: string, attendee: Object, method: string, by: string,
 *          sheets?: Object, now?: Date}} options `attendee` holds the five
 *   display fields copied into the row (no phone number is ever written)
 * @returns {Promise<{status: 'CHECKED_IN'|'ALREADY_CHECKED_IN', record: Object}>}
 */
export async function checkIn({ email: rawEmail, attendee = {}, method, by, sheets = googleSheets, now = new Date() }) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new SheetsError('checkIn called without an email');
  if (!Object.values(METHOD).includes(method)) throw new SheetsError(`Unknown check-in method "${method}"`);

  return withEmailLock(email, async () => {
    const sheet = await ensureTab(sheets);

    const existing = findActive(sheet, email);
    if (existing) return { status: 'ALREADY_CHECKED_IN', record: existing };

    const record = {
      email,
      fullName: text(attendee.fullName),
      enrollmentNumber: text(attendee.enrollmentNumber),
      semester: text(attendee.semester),
      course: text(attendee.course),
      specialization: text(attendee.specialization),
      method,
      checkedInBy: text(by),
      checkedInAt: formatTimestamp(now),
    };

    const width = Math.max(sheet.headers.length, CHECKIN_HEADERS.length);
    const row = buildRow(sheet.map, width, {
      timestamp: record.checkedInAt,
      email: record.email,
      fullName: record.fullName,
      enrollmentNumber: record.enrollmentNumber,
      semester: record.semester,
      course: record.course,
      specialization: record.specialization,
      method: record.method,
      checkedInBy: record.checkedInBy,
      status: CHECKED_IN_STATUS,
    });

    const { rowNumber } = await sheets.appendSheetRow(sheet.spreadsheetId, sheet.sheetName, row);
    invalidate(sheet);

    const winner = await reconcile(sheets, sheet, email, rowNumber);
    if (winner) return { status: 'ALREADY_CHECKED_IN', record: winner };
    return { status: 'CHECKED_IN', record: { ...record, rowNumber } };
  });
}

/**
 * Every live check-in, first per email, for the dashboard.
 * @returns {Promise<{exists: boolean, byEmail: Map<string, Object>}>}
 */
export async function getCheckIns({ sheets = googleSheets, maxAgeMs = ADMIN_CACHE_TTL_MS } = {}) {
  const sheet = await readSheet(sheets, { maxAgeMs });
  const byEmail = new Map();
  for (const record of activeRecords(sheet)) {
    if (!byEmail.has(record.email)) byEmail.set(record.email, record);
  }
  return { exists: sheet.exists, sheetName: sheet.sheetName, byEmail };
}

/** Test-only. */
export function __resetCheckInCache() {
  readCache.clear();
  inFlight.clear();
}
