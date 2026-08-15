/**
 * The ProjectUploads tab.
 *
 * Teams submit a project link through /api/project-upload. This module owns
 * both sides: reading the tab for the admin dashboard, and appending a new
 * submission for an attendee-facing request.
 *
 * A team may submit exactly once. Google Sheets has no transaction and no
 * unique constraint, so "exactly once" is enforced the same way check-in and
 * lunch already enforce "exactly once per email" in api/_lib/attendance.js —
 * see that file's header comment for the full rationale. In short:
 *
 *   1. PER-TEAM SERIALIZATION. Concurrent requests for the same team, inside
 *      one warm lambda, are queued so the second one sees the first one's row.
 *   2. RECONCILIATION AFTER THE WRITE. Two lambda instances can still both
 *      append for the same team; after appending, the tab is re-read and the
 *      lowest row number for that team wins. The loser rewrites its own row's
 *      Submission Status to "Duplicate (ignored)".
 *   3. DEDUPLICATION ON EVERY READ. The admin list and the dropdown-exclusion
 *      set both skip ignored rows, so a hand-added duplicate row can never
 *      resurrect a team that has already submitted.
 *
 * Nothing here touches Registrations, CheckIn or Lunch.
 */

import { googleSheets, isMissingSheetError, columnLetter, SheetsError } from './googleSheets.js';
import { mapHeaders, cellFor, text } from './normalize.js';
import { formatTimestamp } from './time.js';
import { isGeneratedTeamName, getGeneratedTeamNames } from './generatedTeams.js';
import { isProjectSubmissionClosed } from './settings.js';

/** Tab name, overridable like the others. */
export function projectsSheetName() {
  return process.env.SHEET_PROJECTS || 'ProjectUploads';
}

/** Canonical layout, written when this application creates the tab itself. */
export const PROJECT_HEADERS = [
  'Timestamp',
  'Team Name',
  'Google Drive Link',
  'Submission Status',
];

/**
 * Written over a row that lost a duplicate-submission race. Rows carrying it
 * are skipped by every read path, so the row survives as an audit trail
 * without ever counting as a second submission. Nothing is deleted: deleting
 * a row would shift every row below it and corrupt a concurrent writer's
 * reconciliation — the same reasoning as attendance.js's IGNORED_STATUS.
 */
export const DUPLICATE_STATUS = 'Duplicate (ignored)';

const SUBMITTED_STATUS = 'Submitted';

/** Matches the cadence of the other admin reads so one refresh costs one read. */
const CACHE_TTL_MS = 5000;

let cache = null;

/**
 * Only http(s) links are handed to the browser.
 *
 * The value arrives from a sheet a human can type into, and it is rendered as
 * an anchor — so `javascript:` and `data:` URLs are refused here rather than
 * relying on the frontend to be careful. Anything unrecognized is returned as
 * empty, and the dashboard shows the row without a working link.
 */
export function safeLink(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

/** Identity key for matching a submitted team name against a generated one. */
function teamKey(name) {
  return text(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Reads the ProjectUploads tab into records, creating the tab/header row on
 * first use exactly like the previous getProjectUploads() did.
 *
 * @param {Object} sheets the googleSheets port (a fake, in tests)
 * @param {{maxAgeMs?: number}} [options] how stale a cached copy may be;
 *   0 forces a fresh read, which duplicate reconciliation depends on
 */
async function readProjectRows(sheets, { maxAgeMs = CACHE_TTL_MS } = {}) {
  if (maxAgeMs > 0 && cache && Date.now() - cache.at < maxAgeMs) return cache.value;

  let rows;
  try {
    rows = await sheets.getSheetValues(projectsSheetName());
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;

    // Guarded and idempotent: only reached once Google has confirmed the tab
    // is absent, and it adds an empty tab and nothing else.
    await sheets.ensureSheetExists(projectsSheetName());
    rows = [];
  }

  if (!rows.length) {
    const lastColumn = columnLetter(PROJECT_HEADERS.length - 1);
    await sheets.updateSheetValues(projectsSheetName(), `A1:${lastColumn}1`, [PROJECT_HEADERS]);
    rows = [PROJECT_HEADERS];
  }

  const map = mapHeaders(rows[0].map(text));
  const headerCount = rows[0].length;
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamName = cellFor(row, map, 'teamName');
    const driveLink = safeLink(cellFor(row, map, 'driveLink'));
    const status = cellFor(row, map, 'submissionStatus');

    // A row with neither a team nor a link is a blank line, not a submission.
    if (!teamName && !driveLink) continue;

    records.push({
      teamName,
      driveLink,
      timestamp: cellFor(row, map, 'timestamp'),
      status: status || SUBMITTED_STATUS,
      ignored: status === DUPLICATE_STATUS,
      rowNumber: i + 1, // 1-based, header row included
    });
  }

  const value = { map, headerCount, records };
  if (maxAgeMs > 0) cache = { at: Date.now(), value };
  return value;
}

/** Live rows only — an ignored duplicate is not a real submission. */
function activeRecords(sheet) {
  return sheet.records.filter((record) => !record.ignored);
}

/**
 * Reads every project submission for the admin dashboard.
 *
 * @param {{sheets?: Object}} [options]
 * @returns {Promise<{submissions: Array, sheetReady: boolean}>}
 */
export async function getProjectUploads({ sheets = googleSheets } = {}) {
  const sheet = await readProjectRows(sheets);

  const submissions = activeRecords(sheet).map((record) => ({
    teamName: record.teamName || 'Unnamed team',
    driveLink: record.driveLink,
    submittedAt: record.timestamp,
    status: record.status,
  }));

  // Newest first — during judging the useful question is what just arrived.
  submissions.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

  return { submissions, sheetReady: true };
}

/**
 * Canonical (as-generated-casing) names of teams that have already submitted.
 * Feeds the public dropdown's exclusion set.
 */
export async function getSubmittedTeamNames({ sheets = googleSheets } = {}) {
  const sheet = await readProjectRows(sheets);
  const seen = new Set();
  const names = [];

  for (const record of activeRecords(sheet)) {
    const key = teamKey(record.teamName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(record.teamName);
  }

  return names;
}

/**
 * In-process queue, one chain per team name — the same shape as
 * withEmailLock in attendance.js, kept local here since it is small and
 * self-contained. Different teams still run in parallel; the same team never
 * does.
 */
const inFlight = new Map();

function withTeamLock(key, task) {
  const previous = inFlight.get(key) || Promise.resolve();

  const result = previous.then(() => task());
  const settled = result.then(
    () => {},
    () => {}
  );

  inFlight.set(key, settled);
  settled.then(() => {
    if (inFlight.get(key) === settled) inFlight.delete(key);
  });

  return result;
}

/**
 * Appends a new project submission row to the existing ProjectUploads tab.
 *
 * @param {{teamName: string, driveLink: string, sheets?: Object, now?: Date}} options
 * @returns {Promise<{status: string, submission?: Object}>}
 */
export async function submitProjectUpload({
  teamName: rawTeam,
  driveLink: rawLink,
  sheets = googleSheets,
  now = new Date(),
} = {}) {
  if (await isProjectSubmissionClosed({ sheets, now })) {
    return { status: 'SUBMISSIONS_CLOSED' };
  }

  const driveLink = safeLink(rawLink);

  const activeNames = await getGeneratedTeamNames({ sheets });
  if (!activeNames || !activeNames.length) {
    return { status: 'TEAMS_NOT_GENERATED' };
  }

  const teamName = await isGeneratedTeamName(rawTeam, { sheets });
  if (!teamName) {
    return { status: 'INVALID_TEAM_NAME' };
  }

  if (!driveLink) {
    return { status: 'INVALID_DRIVE_LINK' };
  }

  return withTeamLock(teamKey(teamName), async () => {
    const fresh = await readProjectRows(sheets, { maxAgeMs: 0 });
    const alreadySubmitted = activeRecords(fresh).some(
      (record) => teamKey(record.teamName) === teamKey(teamName)
    );
    if (alreadySubmitted) {
      return { status: 'TEAM_ALREADY_SUBMITTED' };
    }

    const map = fresh.map;
    if (map.teamName === undefined || map.driveLink === undefined) {
      throw new SheetsError(`Sheet "${projectsSheetName()}" is missing required headers`);
    }

    const timestamp = formatTimestamp(now);
    const headerCount = Math.max(fresh.headerCount, PROJECT_HEADERS.length);
    const row = new Array(headerCount).fill('');

    if (map.timestamp !== undefined) row[map.timestamp] = timestamp;
    else row[0] = timestamp;

    row[map.teamName] = teamName;
    row[map.driveLink] = driveLink;

    if (map.submissionStatus !== undefined) row[map.submissionStatus] = SUBMITTED_STATUS;
    else if (headerCount > 3) row[3] = SUBMITTED_STATUS;

    const { rowNumber } = await sheets.appendSheetRow(projectsSheetName(), row);
    cache = null; // Clear read cache so admin/dropdown see the submission immediately

    const won = await reconcileTeamRow(sheets, teamName, rowNumber);
    if (!won) {
      return { status: 'TEAM_ALREADY_SUBMITTED' };
    }

    return {
      status: 'PROJECT_SUBMITTED',
      submission: {
        teamName,
        driveLink,
        submittedAt: timestamp,
        status: SUBMITTED_STATUS,
      },
    };
  });
}

/**
 * Re-reads the tab after an append and decides whether `myRowNumber` is the
 * winning row for `teamName`. Loses -> marks its own row DUPLICATE_STATUS.
 *
 * @returns {Promise<boolean>} true when this row is the winner
 */
async function reconcileTeamRow(sheets, teamName, myRowNumber) {
  if (!myRowNumber) return true; // Google did not report a row; nothing to compare.

  const fresh = await readProjectRows(sheets, { maxAgeMs: 0 });
  const key = teamKey(teamName);
  const rivals = activeRecords(fresh).filter((record) => teamKey(record.teamName) === key);
  if (rivals.length <= 1) return true;

  const winner = Math.min(...rivals.map((record) => record.rowNumber));
  if (winner === myRowNumber) return true;

  const statusIndex = fresh.map.submissionStatus;
  if (statusIndex !== undefined) {
    const cell = `${columnLetter(statusIndex)}${myRowNumber}`;
    await sheets.updateSheetValues(projectsSheetName(), cell, [[DUPLICATE_STATUS]]);
    cache = null;
  }
  return false;
}

/** Test-only. */
export function __resetProjectsCache() {
  cache = null;
}
