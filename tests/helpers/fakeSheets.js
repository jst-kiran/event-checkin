/**
 * An in-memory stand-in for Google Sheets.
 *
 * It implements the same three-method port the real client exposes, with the
 * behaviours that actually matter for correctness: appends land at the bottom
 * and report their 1-based row number, reads return ragged rows the way Google
 * does (trailing empty cells omitted), and a missing tab reads as empty.
 *
 * `onBeforeAppend` is the interesting one. It runs inside an append, which is
 * how a test simulates a *second lambda instance* winning the race — something
 * the in-process email lock deliberately prevents from happening any other way.
 */

import { columnLetter, SheetsError } from '../../api/_lib/googleSheets.js';

function parseA1(range) {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!match) throw new Error(`fakeSheets: unsupported range "${range}"`);

  const toIndex = (letters) =>
    [...letters].reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0) - 1;

  return {
    startColumn: toIndex(match[1]),
    startRow: Number(match[2]) - 1,
    endColumn: match[3] ? toIndex(match[3]) : toIndex(match[1]),
    endRow: match[4] ? Number(match[4]) - 1 : Number(match[2]) - 1,
  };
}

export function createFakeSheets(initial = {}) {
  const tabs = new Map(
    Object.entries(initial).map(([name, rows]) => [name, rows.map((row) => [...row])])
  );

  const calls = { get: 0, append: 0, update: 0, ensure: 0 };
  let failure = null;
  let onBeforeAppend = null;

  // Tabs that must behave as genuinely absent until ensureSheetExists creates
  // them — reading one throws the way Google does, which is what lets the
  // "missing ProjectUploads tab" path be exercised.
  const missing = new Set();

  function rowsFor(name) {
    if (!tabs.has(name)) tabs.set(name, []);
    missing.delete(name);
    return tabs.get(name);
  }

  function maybeFail(operation) {
    if (!failure) return;
    if (failure.only && failure.only !== operation) return;
    if (failure.times !== undefined) {
      if (failure.times <= 0) return;
      failure.times--;
    }
    throw failure.error;
  }

  const sheets = {
    async getSheetValues(name) {
      calls.get++;
      maybeFail('get');

      if (missing.has(name)) {
        // Google reports an absent tab as a 400 on range parsing, not a 404.
        throw new SheetsError(
          `Sheets API GET /values/${name} failed (HTTP 400): Unable to parse range: ${name}`,
          { httpStatus: 400 }
        );
      }

      // Deep copy: a caller must not be able to mutate the "spreadsheet".
      return rowsFor(name).map((row) => [...row]);
    },

    async appendSheetRow(name, values) {
      calls.append++;
      maybeFail('append');

      if (onBeforeAppend) {
        const hook = onBeforeAppend;
        onBeforeAppend = null; // fire once, so a hook cannot recurse
        await hook(sheets, name, values);
      }

      const rows = rowsFor(name);
      rows.push([...values]);
      const rowNumber = rows.length;

      return {
        rowNumber,
        updatedRange: `${name}!A${rowNumber}:${columnLetter(values.length - 1)}${rowNumber}`,
      };
    },

    async ensureSheetExists(name) {
      calls.ensure++;
      maybeFail('ensure');
      rowsFor(name); // creating the tab is exactly "make it exist and be empty"
    },

    async updateSheetValues(name, range, values) {
      calls.update++;
      maybeFail('update');

      const { startColumn, startRow } = parseA1(range);
      const rows = rowsFor(name);

      values.forEach((incoming, rowOffset) => {
        const rowIndex = startRow + rowOffset;
        while (rows.length <= rowIndex) rows.push([]);
        const row = rows[rowIndex];
        incoming.forEach((cell, columnOffset) => {
          const columnIndex = startColumn + columnOffset;
          while (row.length <= columnIndex) row.push('');
          row[columnIndex] = cell;
        });
      });
    },
  };

  return {
    sheets,
    calls,
    /** Current contents of a tab, header row included. */
    rows: (name) => rowsFor(name).map((row) => [...row]),
    /** Makes the next `times` operations throw. */
    failWith(error, { only, times } = {}) {
      failure = { error, only, times };
    },
    clearFailure() {
      failure = null;
    },
    /** Runs once, inside the next append, before the row is written. */
    beforeNextAppend(hook) {
      onBeforeAppend = hook;
    },
    /** Makes a tab behave as though it does not exist in the spreadsheet. */
    markMissing(name) {
      tabs.delete(name);
      missing.add(name);
    },
    /** True once the tab has been created (or written to). */
    exists(name) {
      return tabs.has(name) && !missing.has(name);
    },
  };
}

/** The canonical tabs, with just a header row — what a prepared sheet looks like. */
export const EMPTY_SHEETS = {
  CheckIn: [
    ['Timestamp', 'Email', 'Name', 'Organization', 'Designation', 'Phone', 'Meal Preference', 'Check-in Status'],
  ],
  Lunch: [['Timestamp', 'Email', 'Name', 'Meal Preference', 'Lunch Status']],
};
