/**
 * The project-submission deadline.
 *
 * A tiny key/value tab (`Settings`), following the same "durable state lives
 * in a sheet, not in lambda memory" rule as every other tab in this project.
 * It holds exactly one row today — `projectSubmissionDeadline` — but is
 * shaped as key/value rather than a bespoke single-cell layout so a second
 * admin-configurable setting later doesn't need its own tab.
 *
 * IST, always. The admin picks a date and time with a plain
 * `<input type="datetime-local">`, which carries no timezone at all — just
 * "2026-08-20T18:30". This module treats that as India Standard Time and
 * nothing else. That is safe to do with a fixed "+05:30" suffix rather than
 * real timezone conversion because IST has no DST (see the same assumption in
 * api/_lib/time.js's EVENT_TIMEZONE), so the offset never changes across the
 * year. The stored value is an offset-ISO string — e.g.
 * "2026-08-20T18:30:00+05:30" — the same shape formatTimestamp() already
 * writes into every other tab, so `new Date(stored)` is always correct
 * regardless of where the server or a reader's browser happens to be.
 */

import { googleSheets, isMissingSheetError, columnLetter } from './googleSheets.js';
import { mapHeaders, text } from './normalize.js';

export function settingsSheetName() {
  return process.env.SHEET_SETTINGS || 'Settings';
}

export const SETTINGS_HEADERS = ['Key', 'Value'];

const DEADLINE_KEY = 'projectSubmissionDeadline';
const IST_SUFFIX = ':00+05:30';
const LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Deliberately invalid input from the admin form, not a server failure. */
export class InvalidDeadlineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidDeadlineError';
  }
}

const CACHE_TTL_MS = 3000;
let cache = null;

async function readDeadline({ sheets = googleSheets } = {}) {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let rows;
  try {
    rows = await sheets.getSheetValues(settingsSheetName());
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;
    rows = [];
  }

  let deadline = null;
  if (rows.length > 1) {
    const map = mapHeaders(rows[0].map(text));
    const keyIdx = map.key !== undefined ? map.key : 0;
    const valueIdx = map.value !== undefined ? map.value : 1;

    for (let i = 1; i < rows.length; i++) {
      if (text(rows[i][keyIdx]) === DEADLINE_KEY) {
        deadline = text(rows[i][valueIdx]) || null;
        break;
      }
    }
  }

  cache = { at: Date.now(), value: deadline };
  return deadline;
}

/** @returns {Promise<string|null>} offset-ISO deadline, or null when unset */
export async function getProjectSubmissionDeadline({ sheets } = {}) {
  return readDeadline({ sheets });
}

/** @returns {Promise<boolean>} true once `now` has passed the deadline */
export async function isProjectSubmissionClosed({ sheets, now = new Date() } = {}) {
  const deadline = await getProjectSubmissionDeadline({ sheets });
  if (!deadline) return false;

  const parsed = new Date(deadline);
  return !Number.isNaN(parsed.getTime()) && now.getTime() >= parsed.getTime();
}

/**
 * @param {string|null} localValue "YYYY-MM-DDTHH:mm" (IST wall clock) from a
 *   datetime-local input, or a falsy value to clear the deadline and reopen
 *   submissions indefinitely.
 * @returns {Promise<string|null>} the stored offset-ISO value, or null when cleared
 */
export async function setProjectSubmissionDeadline(localValue, { sheets = googleSheets } = {}) {
  let value = '';
  if (localValue) {
    if (!LOCAL_PATTERN.test(localValue)) {
      throw new InvalidDeadlineError('Deadline must look like YYYY-MM-DDTHH:mm.');
    }
    const iso = `${localValue}${IST_SUFFIX}`;
    if (Number.isNaN(new Date(iso).getTime())) {
      throw new InvalidDeadlineError('Deadline is not a valid date/time.');
    }
    value = iso;
  }

  let rows;
  try {
    rows = await sheets.getSheetValues(settingsSheetName());
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;
    await sheets.ensureSheetExists(settingsSheetName());
    rows = [];
  }

  if (!rows.length) {
    await sheets.updateSheetValues(settingsSheetName(), 'A1:B1', [SETTINGS_HEADERS]);
    rows = [SETTINGS_HEADERS];
  }

  const map = mapHeaders(rows[0].map(text));
  const keyIdx = map.key !== undefined ? map.key : 0;
  const valueIdx = map.value !== undefined ? map.value : 1;

  let rowNumber = null;
  for (let i = 1; i < rows.length; i++) {
    if (text(rows[i][keyIdx]) === DEADLINE_KEY) {
      rowNumber = i + 1;
      break;
    }
  }

  if (rowNumber) {
    await sheets.updateSheetValues(
      settingsSheetName(),
      `${columnLetter(valueIdx)}${rowNumber}`,
      [[value]]
    );
  } else {
    const row = [];
    row[keyIdx] = DEADLINE_KEY;
    row[valueIdx] = value;
    await sheets.appendSheetRow(settingsSheetName(), row.map((cell) => cell ?? ''));
  }

  cache = null;
  return value || null;
}

/** Test-only: forces the next read to go back to the sheet. */
export function __resetSettingsCache() {
  cache = null;
}
