/**
 * The ProjectUploads tab.
 *
 * Teams will eventually submit a project link through a form that does not
 * exist yet. This module is the read side only: it lets the admin dashboard
 * display whatever has landed in the tab, so the panel is ready the moment the
 * submission form is built.
 *
 * Nothing here touches Registrations, CheckIn or Lunch. ProjectUploads is a
 * separate tab with its own shape, and the check-in and lunch flows are
 * completely unaware of it.
 */

import { googleSheets, isMissingSheetError, columnLetter } from './googleSheets.js';
import { mapHeaders, cellFor, text } from './normalize.js';

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
function safeLink(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * Reads every project submission.
 *
 * A missing tab is not an error: before the submission form exists, or before
 * an organizer has created the tab, the honest answer is "no submissions yet".
 * The tab is created on that first read so it is ready to receive rows.
 *
 * @param {{sheets?: Object}} [options]
 * @returns {Promise<{submissions: Array, sheetReady: boolean}>}
 */
export async function getProjectUploads({ sheets = googleSheets } = {}) {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

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
  const submissions = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamName = cellFor(row, map, 'teamName');
    const driveLink = safeLink(cellFor(row, map, 'driveLink'));

    // A row with neither a team nor a link is a blank line, not a submission.
    if (!teamName && !driveLink) continue;

    submissions.push({
      teamName: teamName || 'Unnamed team',
      driveLink,
      submittedAt: cellFor(row, map, 'timestamp'),
      status: cellFor(row, map, 'submissionStatus') || 'Submitted',
    });
  }

  // Newest first — during judging the useful question is what just arrived.
  submissions.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

  const value = { submissions, sheetReady: true };
  cache = { at: Date.now(), value };
  return value;
}

/** Test-only. */
export function __resetProjectsCache() {
  cache = null;
}
