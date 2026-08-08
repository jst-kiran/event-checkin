/**
 * Check-in and lunch: everything that touches the live Google Sheets.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED THE WAY IT IS
 * ---------------------------------------------------------------------------
 * Google Sheets is a spreadsheet, not a database. There is no transaction, no
 * unique constraint and no compare-and-swap. Two operators scanning the same
 * attendee on two phones a few milliseconds apart will both read "not checked
 * in yet" and both append. Pretending otherwise would be the bug.
 *
 * So duplicates are made harmless in three layers instead of being wished away:
 *
 *   1. PER-EMAIL SERIALIZATION. Requests for the same email are queued inside
 *      the process. A single warm lambda — the common case at one desk — turns
 *      a double-tap or a double-scan into a strict sequence, so the second
 *      request sees the first one's row and reports ALREADY_CHECKED_IN.
 *
 *   2. RECONCILIATION AFTER THE WRITE. Appends across two lambda instances can
 *      still interleave, so after appending we re-read the tab. Google assigns
 *      every append its own row number, and the lowest row number for an email
 *      wins — a rule both racers evaluate identically, from the same data,
 *      without talking to each other. The loser rewrites its own row's status
 *      cell to "Duplicate (ignored)" and reports ALREADY_CHECKED_IN. The sheet
 *      self-heals and the attendee sees the truth.
 *
 *   3. DEDUPLICATION ON EVERY READ. Counts, the dashboard and the team draw all
 *      collapse by normalized email and skip ignored rows, so even a row added
 *      by hand in the spreadsheet cannot inflate a number or put one person on
 *      two teams.
 *
 * The residual window is small but real, and it is documented in the README
 * rather than papered over: between reading and appending, a *different*
 * instance may append the same email. That produces one extra row which layer 2
 * marks and layer 3 ignores — never two attendees counted, never a person let
 * in twice without the desk being told.
 */

import { googleSheets, SHEET_NAMES, SheetsError, columnLetter } from './googleSheets.js';
import { mapHeaders, cellFor, normalizeEmail, text, mealKey } from './normalize.js';
import { formatTimestamp } from './time.js';
import {
  findRegistrationByEmail,
  getAllRegistrations,
  getRegistrationCount,
  getMealCategories,
} from './registrations.js';

/** Status values this application writes. */
export const CHECKED_IN_STATUS = 'Checked In';
export const CLAIMED_STATUS = 'Claimed';

/**
 * Written over a row that lost a duplicate race. Rows carrying it are ignored
 * by every read path, so the row survives as an audit trail without ever being
 * counted. Nothing is deleted: deleting a row shifts every row below it, which
 * would corrupt a concurrent writer's reconciliation.
 */
export const IGNORED_STATUS = 'Duplicate (ignored)';

/** Canonical layout, used when this application creates the tab itself. */
export const CHECKIN_HEADERS = [
  'Timestamp',
  'Email',
  'Name',
  'Organization',
  'Designation',
  'Phone',
  'Meal Preference',
  'Check-in Status',
];

export const LUNCH_HEADERS = ['Timestamp', 'Email', 'Name', 'Meal Preference', 'Lunch Status'];

/**
 * Sheets allows only 60 read requests per minute per service account. A busy
 * desk with two devices would brush that limit, so reads inside the write path
 * are cached for a few seconds.
 *
 * This cannot cause a false ALREADY_CHECKED_IN: a stale copy can only be
 * missing recent rows, never inventing them. A stale copy that misses a row
 * leads to an append, and the reconciliation pass — which always bypasses the
 * cache — catches it.
 */
const READ_CACHE_TTL_MS = 3000;

const readCache = new Map();

/* ==========================================================================
 * SHEET ACCESS
 * ========================================================================== */

/**
 * Reads a tab into records keyed by normalized email.
 *
 * Column positions are resolved from the header row rather than assumed, so an
 * organizer who reorders the columns, or creates the tab with slightly
 * different titles, does not break the desk.
 *
 * @param {Object} sheets the googleSheets port (a fake, in tests)
 * @param {string} sheetName
 * @param {{fresh?: boolean}} [options] `fresh` bypasses the cache
 * @returns {Promise<{headers: string[], map: Object, records: Array}>}
 */
async function readSheet(sheets, sheetName, { fresh = false } = {}) {
  const cached = readCache.get(sheetName);
  if (!fresh && cached && Date.now() - cached.at < READ_CACHE_TTL_MS) return cached.value;

  const rows = await sheets.getSheetValues(sheetName);
  const headers = rows.length ? rows[0].map(text) : [];
  const map = mapHeaders(headers);

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const email = normalizeEmail(cellFor(row, map, 'email'));
    if (!email) continue;

    const status = cellFor(row, map, 'checkInStatus') || cellFor(row, map, 'lunchStatus');
    records.push({
      email,
      name: cellFor(row, map, 'name'),
      organization: cellFor(row, map, 'organization'),
      mealPreference: cellFor(row, map, 'mealPreference'),
      timestamp: cellFor(row, map, 'timestamp'),
      status,
      ignored: status === IGNORED_STATUS,
      rowNumber: i + 1, // 1-based, header row included
    });
  }

  const value = { headers, map, records };
  readCache.set(sheetName, { at: Date.now(), value });
  return value;
}

/** Live rows only — an ignored duplicate is not a check-in. */
function activeRecords(sheet) {
  return sheet.records.filter((record) => !record.ignored);
}

/** First live row for an email, or null. */
function findActive(sheet, email) {
  return activeRecords(sheet).find((record) => record.email === email) || null;
}

/**
 * Guarantees the tab has a usable header row.
 *
 * A tab an organizer created but left empty is the common case; writing the
 * canonical header into it is idempotent, so two instances doing it at once
 * write identical bytes.
 */
async function ensureHeaders(sheets, sheetName, canonicalHeaders) {
  const sheet = await readSheet(sheets, sheetName, { fresh: true });
  if (sheet.headers.length && sheet.map.email !== undefined) return sheet;

  if (sheet.headers.length && sheet.map.email === undefined) {
    // Populated, but nothing that reads as an email column. Appending here
    // would scatter data into the wrong columns.
    throw new SheetsError(`Sheet "${sheetName}" has no recognizable Email column`);
  }

  const lastColumn = columnLetter(canonicalHeaders.length - 1);
  await sheets.updateSheetValues(sheetName, `A1:${lastColumn}1`, [canonicalHeaders]);
  readCache.delete(sheetName);
  return readSheet(sheets, sheetName, { fresh: true });
}

/** Lays values out according to the tab's actual header positions. */
function buildRow(map, headerCount, fields) {
  const row = new Array(headerCount).fill('');
  for (const [field, value] of Object.entries(fields)) {
    const index = map[field];
    if (index !== undefined && index < headerCount) row[index] = value;
  }
  return row;
}

/* ==========================================================================
 * CONCURRENCY
 * ========================================================================== */

/**
 * In-process queue, one chain per email.
 *
 * Different attendees still run in parallel; the same attendee never does.
 * Entries are dropped once their chain drains, so this cannot grow unbounded
 * over an event.
 */
const inFlight = new Map();

function withEmailLock(email, task) {
  const previous = inFlight.get(email) || Promise.resolve();

  // The queued promise swallows outcomes so one failed check-in cannot reject
  // the chain and take the next attendee down with it.
  const result = previous.then(() => task());
  const settled = result.then(
    () => {},
    () => {}
  );

  inFlight.set(email, settled);
  settled.then(() => {
    // Only the last task in the chain clears the entry; anything queued behind
    // this one has already replaced the map value.
    if (inFlight.get(email) === settled) inFlight.delete(email);
  });

  return result;
}

/**
 * Decides whether an appended row is the authoritative one.
 *
 * Both racers re-read the same tab and apply the same rule — lowest row number
 * for the email wins — so they reach opposite conclusions about themselves and
 * exactly one row survives. The loser marks its own row and reports the
 * conflict.
 *
 * @returns {Promise<boolean>} true when this row is the winner
 */
async function reconcile(sheets, sheetName, email, myRowNumber, statusField) {
  if (!myRowNumber) return true; // Google did not report a row; nothing to compare.

  const sheet = await readSheet(sheets, sheetName, { fresh: true });
  const rivals = activeRecords(sheet).filter((record) => record.email === email);
  if (rivals.length <= 1) return true;

  const winner = Math.min(...rivals.map((record) => record.rowNumber));
  if (winner === myRowNumber) return true;

  const statusIndex = sheet.map[statusField];
  if (statusIndex !== undefined) {
    const cell = `${columnLetter(statusIndex)}${myRowNumber}`;
    await sheets.updateSheetValues(sheetName, cell, [[IGNORED_STATUS]]);
    readCache.delete(sheetName);
  }
  return false;
}

/* ==========================================================================
 * CHECK-IN
 * ========================================================================== */

/**
 * POST /api/checkin's engine.
 *
 * @param {{email: string, sheets?: Object, now?: Date}} options
 * @returns {Promise<{status: string, attendee: Object|null}>} one of
 *   CHECKED_IN, ALREADY_CHECKED_IN, REGISTRATION_NOT_FOUND
 */
export async function checkInAttendee({ email: rawEmail, sheets = googleSheets, now = new Date() }) {
  const email = normalizeEmail(rawEmail);

  // The frozen snapshot answers this without touching the network, so an
  // unregistered email never costs a Google request.
  const registration = findRegistrationByEmail(email);
  if (!registration) return { status: 'REGISTRATION_NOT_FOUND', attendee: null };

  return withEmailLock(email, async () => {
    const sheetName = SHEET_NAMES.checkIn;
    const sheet = await ensureHeaders(sheets, sheetName, CHECKIN_HEADERS);

    if (findActive(sheet, email)) {
      return { status: 'ALREADY_CHECKED_IN', attendee: registration };
    }

    const row = buildRow(sheet.map, Math.max(sheet.headers.length, CHECKIN_HEADERS.length), {
      timestamp: formatTimestamp(now),
      email: registration.email,
      name: registration.name,
      organization: registration.organization,
      designation: registration.designation,
      phone: registration.phone,
      mealPreference: registration.mealPreference,
      checkInStatus: CHECKED_IN_STATUS,
    });

    const { rowNumber } = await sheets.appendSheetRow(sheetName, row);
    readCache.delete(sheetName);

    const won = await reconcile(sheets, sheetName, email, rowNumber, 'checkInStatus');
    return {
      status: won ? 'CHECKED_IN' : 'ALREADY_CHECKED_IN',
      attendee: registration,
    };
  });
}

/* ==========================================================================
 * LUNCH
 * ========================================================================== */

/**
 * POST /api/lunch's engine.
 *
 * Meal preference is read from the frozen registration, never from the
 * request, so an attendee cannot upgrade their own meal at the counter.
 *
 * @returns {Promise<{status: string, attendee: Object|null}>} one of
 *   LUNCH_APPROVED, ALREADY_CLAIMED, PLEASE_CHECK_IN_FIRST,
 *   REGISTRATION_NOT_FOUND
 */
export async function claimLunch({ email: rawEmail, sheets = googleSheets, now = new Date() }) {
  const email = normalizeEmail(rawEmail);

  const registration = findRegistrationByEmail(email);
  if (!registration) return { status: 'REGISTRATION_NOT_FOUND', attendee: null };

  return withEmailLock(email, async () => {
    const checkInSheet = await readSheet(sheets, SHEET_NAMES.checkIn);
    if (!findActive(checkInSheet, email)) {
      return { status: 'PLEASE_CHECK_IN_FIRST', attendee: registration };
    }

    const sheetName = SHEET_NAMES.lunch;
    const lunchSheet = await ensureHeaders(sheets, sheetName, LUNCH_HEADERS);

    if (findActive(lunchSheet, email)) {
      return { status: 'ALREADY_CLAIMED', attendee: registration };
    }

    const row = buildRow(lunchSheet.map, Math.max(lunchSheet.headers.length, LUNCH_HEADERS.length), {
      timestamp: formatTimestamp(now),
      email: registration.email,
      name: registration.name,
      mealPreference: registration.mealPreference,
      lunchStatus: CLAIMED_STATUS,
    });

    const { rowNumber } = await sheets.appendSheetRow(sheetName, row);
    readCache.delete(sheetName);

    const won = await reconcile(sheets, sheetName, email, rowNumber, 'lunchStatus');
    return {
      status: won ? 'LUNCH_APPROVED' : 'ALREADY_CLAIMED',
      attendee: registration,
    };
  });
}

/* ==========================================================================
 * ADMIN READS
 * ========================================================================== */

/** Unique, non-ignored emails on a tab, first occurrence wins. */
function uniqueByEmail(sheet) {
  const seen = new Map();
  for (const record of activeRecords(sheet)) {
    if (!seen.has(record.email)) seen.set(record.email, record);
  }
  return seen;
}

/**
 * The check-in log, deduplicated and enriched from the frozen snapshot.
 *
 * Registration data wins over whatever the sheet row holds: the snapshot is
 * authoritative, and a row edited by hand should not change what the dashboard
 * reports. Phone and designation are dropped here — the table does not show
 * them, so they never leave the server.
 */
export async function getCheckInLog({ sheets = googleSheets } = {}) {
  const [checkInSheet, lunchSheet] = await Promise.all([
    readSheet(sheets, SHEET_NAMES.checkIn, { fresh: true }),
    readSheet(sheets, SHEET_NAMES.lunch, { fresh: true }),
  ]);

  const lunchEmails = new Set(uniqueByEmail(lunchSheet).keys());

  return [...uniqueByEmail(checkInSheet).values()].map((record) => {
    const registration = findRegistrationByEmail(record.email);
    return {
      name: registration?.name || record.name || record.email,
      email: record.email,
      organization: registration?.organization || record.organization || '',
      mealPreference: registration?.mealPreference || record.mealPreference || '',
      checkedInAt: record.timestamp || '',
      lunchClaimed: lunchEmails.has(record.email),
      registered: Boolean(registration),
    };
  });
}

/**
 * Dashboard figures, all derived from live data at request time.
 *
 * @returns {Promise<Object>} counts plus a lunch breakdown whose categories
 *   come from the registration data rather than a hardcoded list
 */
export async function getStats({ sheets = googleSheets } = {}) {
  const [checkInSheet, lunchSheet] = await Promise.all([
    readSheet(sheets, SHEET_NAMES.checkIn, { fresh: true }),
    readSheet(sheets, SHEET_NAMES.lunch, { fresh: true }),
  ]);

  const registered = getRegistrationCount();
  const checkedInEmails = uniqueByEmail(checkInSheet);
  const lunchEmails = uniqueByEmail(lunchSheet);

  // Only registered attendees can reduce "yet to check in". A row typed
  // straight into the sheet for someone not on the guest list must not make
  // the outstanding count go down — or negative.
  let checkedInAndRegistered = 0;
  for (const email of checkedInEmails.keys()) {
    if (findRegistrationByEmail(email)) checkedInAndRegistered++;
  }

  const categories = getMealCategories();
  const byPreference = new Map([...categories].map(([key, label]) => [key, { label, count: 0 }]));
  let unspecified = 0;

  for (const email of lunchEmails.keys()) {
    const registration = findRegistrationByEmail(email);
    const key = mealKey(registration?.mealPreference);
    if (!key) {
      unspecified++;
      continue;
    }
    if (!byPreference.has(key)) byPreference.set(key, { label: key, count: 0 });
    byPreference.get(key).count++;
  }

  const lunchByPreference = [...byPreference.values()].sort((a, b) => b.count - a.count);
  if (unspecified) lunchByPreference.push({ label: 'Not specified', count: unspecified });

  return {
    registered,
    checkedIn: checkedInEmails.size,
    lunchClaimed: lunchEmails.size,
    yetToCheckIn: Math.max(0, registered - checkedInAndRegistered),
    lunchByPreference,
  };
}

/**
 * The roster for the team draw: everyone currently checked in, once each.
 *
 * Built from the live sheet rather than from whatever the browser last
 * rendered, so a page left open for an hour still draws against reality.
 */
export async function getCheckedInRoster({ sheets = googleSheets } = {}) {
  const sheet = await readSheet(sheets, SHEET_NAMES.checkIn, { fresh: true });

  return [...uniqueByEmail(sheet).values()].map((record) => {
    const registration = findRegistrationByEmail(record.email);
    return {
      name: registration?.name || record.name || record.email,
      email: record.email,
      organization: registration?.organization || record.organization || '',
    };
  });
}

/** Registered attendees who have not checked in. Admin-only by construction. */
export async function getPendingAttendees({ sheets = googleSheets } = {}) {
  const sheet = await readSheet(sheets, SHEET_NAMES.checkIn, { fresh: true });
  const checkedIn = new Set(uniqueByEmail(sheet).keys());
  return getAllRegistrations().filter((attendee) => !checkedIn.has(attendee.email));
}

/** Test-only: clears the short-lived read cache between cases. */
export function __resetReadCache() {
  readCache.clear();
}
