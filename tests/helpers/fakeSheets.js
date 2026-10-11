/**
 * An in-memory stand-in for Google Sheets.
 *
 * It implements the same four-method port as the real client and behaves the
 * way Google does where it matters: reads return deep copies and ragged rows
 * stay ragged; an unknown spreadsheet is a 404 and an unknown tab a 400
 * "Unable to parse range"; appends land at the bottom and report their 1-based
 * row number; creating a tab that exists fails with "already exists".
 *
 * Every write is logged with the tab it targeted, so tests can prove the
 * registration tab is never written. As a second line of defence the fake
 * itself refuses — loudly — any write to a tab listed in `readOnlyTabs`.
 *
 * `onBeforeAppend` runs inside an append; it is how a test simulates a second
 * server instance winning a race.
 */

import { SheetsError } from '../../api/_lib/googleSheets.js';

function parseA1(range) {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!match) throw new Error(`fakeSheets: unsupported range "${range}"`);
  const toIndex = (letters) => [...letters].reduce((total, c) => total * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  return { column: toIndex(match[1]), row: Number(match[2]) - 1 };
}

/**
 * @param {Object<string, Object<string, Array<Array<string>>>>} spreadsheets
 *   spreadsheetId -> tab name -> rows (header first)
 * @param {{readOnlyTabs?: string[]}} [options]
 */
export function createFakeSheets(spreadsheets = {}, { readOnlyTabs = [] } = {}) {
  const data = structuredClone(spreadsheets);
  const calls = { get: 0, requests: [], writes: [], created: [] };
  let failure = null;
  let writeFailure = null;
  let onBeforeAppend = null;

  const tab = (spreadsheetId, sheetName) => {
    const book = data[spreadsheetId];
    if (!book) throw new SheetsError('Sheets API GET failed (HTTP 404)', { httpStatus: 404 });
    const rows = book[sheetName];
    if (!rows) throw new SheetsError('Sheets API GET failed (HTTP 400): Unable to parse range', { httpStatus: 400 });
    return rows;
  };

  const recordWrite = (kind, spreadsheetId, sheetName, payload) => {
    calls.writes.push({ kind, spreadsheetId, sheetName, payload: structuredClone(payload) });
    if (readOnlyTabs.includes(sheetName)) {
      throw new Error(`fakeSheets: WRITE TO READ-ONLY TAB "${sheetName}" (${kind})`);
    }
    if (writeFailure) throw writeFailure;
  };

  const sheets = {
    async getSheetValues(spreadsheetId, sheetName) {
      calls.get++;
      calls.requests.push({ spreadsheetId, sheetName });
      if (failure) throw failure;
      return structuredClone(tab(spreadsheetId, sheetName));
    },

    async appendSheetRow(spreadsheetId, sheetName, values) {
      recordWrite('append', spreadsheetId, sheetName, values);
      if (onBeforeAppend) {
        const hook = onBeforeAppend;
        onBeforeAppend = null;
        await hook();
      }
      const rows = tab(spreadsheetId, sheetName);
      // Google drops trailing empty cells; so do we.
      const trimmed = [...values];
      while (trimmed.length && trimmed[trimmed.length - 1] === '') trimmed.pop();
      rows.push(trimmed);
      return { rowNumber: rows.length };
    },

    async updateSheetValues(spreadsheetId, sheetName, a1Range, values) {
      recordWrite('update', spreadsheetId, sheetName, { a1Range, values });
      const rows = tab(spreadsheetId, sheetName);
      const start = parseA1(a1Range.split(':')[0]);
      values.forEach((rowValues, r) => {
        const target = (rows[start.row + r] = rows[start.row + r] || []);
        rowValues.forEach((value, c) => {
          while (target.length < start.column + c) target.push('');
          target[start.column + c] = value;
        });
      });
    },

    async createCheckInTab(spreadsheetId, sheetName, layout) {
      recordWrite('create', spreadsheetId, sheetName, layout);
      calls.created.push({ spreadsheetId, sheetName, layout: structuredClone(layout) });
      const book = (data[spreadsheetId] = data[spreadsheetId] || {});
      if (book[sheetName]) throw new SheetsError(`A sheet with the name "${sheetName}" already exists`);
      book[sheetName] = [[...layout.headers]];
    },
  };

  return {
    sheets,
    calls,
    /** Makes every subsequent read throw `error` (null to recover). */
    failWith(error) {
      failure = error;
    },
    /** Makes every subsequent write throw `error` (null to recover). */
    failWritesWith(error) {
      writeFailure = error;
    },
    /** Runs once, inside the next append — simulates a concurrent instance. */
    beforeNextAppend(hook) {
      onBeforeAppend = hook;
    },
    /** Direct access for assertions and for simulating hand edits. */
    rows(spreadsheetId, sheetName) {
      return data[spreadsheetId]?.[sheetName];
    },
    setRows(spreadsheetId, sheetName, rows) {
      data[spreadsheetId] = data[spreadsheetId] || {};
      data[spreadsheetId][sheetName] = structuredClone(rows);
    },
  };
}
