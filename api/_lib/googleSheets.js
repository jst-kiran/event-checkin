/**
 * The only place in this codebase that talks to Google.
 *
 * Authentication is the standard OAuth 2.0 service-account flow: sign a short
 * JWT with the account's RSA key, exchange it for an access token, cache the
 * token until shortly before it expires. That is roughly sixty lines here and
 * costs nothing at cold start, which is why there is no Google SDK dependency.
 *
 * WHAT MAY BE WRITTEN — AND WHAT MAY NOT
 * --------------------------------------
 * The registration tab ("Form responses 1") is the event's source of truth and
 * is never written. The only tab this module will ever change is the check-in
 * tab (CHECKIN_SHEET_NAME, "CheckIns" by default). That is enforced here, in
 * code, independently of anything the callers do:
 *
 *   1. Reads use a token for the `spreadsheets.readonly` scope, so Google
 *      itself refuses any write made with it.
 *   2. Every write operation calls assertWritableTab() first, which refuses
 *      any tab other than the check-in tab — and refuses outright if the
 *      check-in tab is configured with the registration tab's name.
 *   3. A write-scoped token is minted only inside those guarded functions.
 *
 * You can add a fourth, outside the code: protect the registration tab in
 * Google Sheets (Data → Protect sheets and ranges → "Only you"). Then even the
 * service account's Editor access cannot change it.
 *
 * Nothing in this module is importable from the browser bundle — it lives
 * under api/_lib, is only ever imported by serverless functions and scripts,
 * and reads its credentials from non-VITE_ environment variables.
 */

import crypto from 'node:crypto';
import { normalizeHeader } from './normalize.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Used for every read. Google refuses any write made with this token. */
export const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Used only inside the guarded write functions below. */
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** Google tokens last an hour; refresh a minute early to absorb clock skew. */
const TOKEN_SAFETY_WINDOW_SECONDS = 60;

/** Google is a hard dependency of a live desk — do not let a request hang. */
const REQUEST_TIMEOUT_MS = 15000;

/** Transient failures worth one immediate retry before giving up. */
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

export class SheetsError extends Error {
  /**
   * @param {string} message logged server-side only
   * @param {{retryable?: boolean, httpStatus?: number}} [options]
   *   `retryable` marks a Google-side outage; `httpStatus` is Google's status,
   *   e.g. 403 when the sheet has not been shared with the service account.
   */
  constructor(message, { retryable = false, httpStatus } = {}) {
    super(message);
    this.name = 'SheetsError';
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

/* ==========================================================================
 * CONFIGURATION
 * ========================================================================== */

/**
 * Normalizes the private key.
 *
 * A PEM key cannot survive a .env file as-is, so it is almost always stored
 * with literal `\n` escapes and wrapping quotes. Vercel's dashboard, by
 * contrast, accepts a genuinely multi-line value. Both arrive here and both
 * have to end up as a real PEM block.
 */
function normalizePrivateKey(raw) {
  if (!raw) return '';
  let key = raw.trim();

  // Strip a single layer of wrapping quotes left by a .env parser.
  if (key.length > 1 && /^(['"]).*\1$/s.test(key)) key = key.slice(1, -1);

  return key.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

/**
 * The service-account credentials. Which spreadsheet to read is not part of
 * this — callers pass it explicitly (see api/_lib/registrations.js).
 */
export function readCredentials() {
  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  const missing = [];
  if (!clientEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_PRIVATE_KEY');

  if (missing.length) {
    throw new SheetsError(`Missing environment variables: ${missing.join(', ')}`);
  }
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new SheetsError('GOOGLE_PRIVATE_KEY does not look like a PEM private key');
  }

  return { clientEmail, privateKey };
}

/** True when the deployment has service-account credentials. */
export function isConfigured() {
  try {
    readCredentials();
    return true;
  } catch {
    return false;
  }
}

/** The one tab this application is allowed to write to. */
export function checkInSheetName() {
  return String(process.env.CHECKIN_SHEET_NAME || 'CheckIns').trim();
}

/**
 * The write guard. Throws unless `sheetName` is exactly the check-in tab and
 * that tab is not, under any spelling, the registration tab.
 */
export function assertWritableTab(sheetName) {
  const allowed = checkInSheetName();
  const registration = String(process.env.REGISTRATION_SHEET_NAME || '').trim();

  if (!allowed || normalizeHeader(allowed) === normalizeHeader(registration)) {
    throw new SheetsError(
      'Refusing to write: CHECKIN_SHEET_NAME must name a tab other than the registration tab'
    );
  }
  if (sheetName !== allowed) {
    throw new SheetsError(`Refusing to write to tab "${sheetName}" — only "${allowed}" is writable`);
  }
}

/* ==========================================================================
 * ACCESS TOKENS
 * ========================================================================== */

// Module scope, one per OAuth scope, so a warm lambda reuses its tokens across
// requests instead of paying a round trip per lookup.
const cachedTokens = new Map();

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Signs the assertion Google exchanges for an access token. */
function buildAssertion({ clientEmail, privateKey }, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const body = `${header}.${claims}`;
  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(body).sign(privateKey);
  } catch (error) {
    // A malformed key fails here, long before any network call.
    throw new SheetsError(`Could not sign with GOOGLE_PRIVATE_KEY: ${error.message}`);
  }

  return `${body}.${signature.toString('base64url')}`;
}

async function getAccessToken(scope) {
  const cached = cachedTokens.get(scope);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const assertion = buildAssertion(readCredentials(), scope);

  const response = await withTimeout((signal) =>
    fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal,
    })
  );

  const payload = await readJson(response);

  if (!response.ok || !payload?.access_token) {
    // payload.error is Google's machine code ("invalid_grant"); it is logged
    // for the operator but never returned to a caller.
    throw new SheetsError(
      `Token request failed (HTTP ${response.status}): ${payload?.error || 'no access_token'}`,
      { retryable: RETRYABLE_HTTP.has(response.status), httpStatus: response.status }
    );
  }

  const ttl = Number(payload.expires_in) || 3600;
  cachedTokens.set(scope, {
    value: payload.access_token,
    expiresAt: Date.now() + (ttl - TOKEN_SAFETY_WINDOW_SECONDS) * 1000,
  });
  return payload.access_token;
}

/* ==========================================================================
 * TRANSPORT
 * ========================================================================== */

async function withTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new SheetsError(`Google did not respond within ${REQUEST_TIMEOUT_MS}ms`, {
        retryable: true,
      });
    }
    throw new SheetsError(`Could not reach Google: ${error.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw.slice(0, 300) };
  }
}

/** Google's most common failures, translated into what the operator must fix. */
function explainStatus(status, method) {
  if (status === 403) {
    return method === 'GET'
      ? 'permission denied — share the spreadsheet with GOOGLE_SERVICE_ACCOUNT_EMAIL'
      : 'permission denied — the service account needs Editor access to record check-ins';
  }
  if (status === 404) return 'spreadsheet not found — check REGISTRATION_SHEET_ID';
  if (status === 400) return 'bad request — usually a tab name that does not exist';
  return '';
}

/**
 * One authenticated Sheets API call, with a single retry on transient errors.
 * GETs always use the read-only token; anything else needs the write token,
 * which only the guarded functions below ask for.
 */
async function sheetsRequest(spreadsheetId, path, { method = 'GET', query, body } = {}) {
  if (!spreadsheetId) throw new SheetsError('No spreadsheet ID supplied');
  const scope = method === 'GET' ? READ_SCOPE : WRITE_SCOPE;

  const url = new URL(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(scope);

    const response = await withTimeout((signal) =>
      fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })
    );

    if (response.ok) return (await readJson(response)) || {};

    const payload = await readJson(response);
    const detail = payload?.error?.message || payload?._raw || 'no detail';

    // A rejected token usually means it expired against a skewed clock; drop
    // the cache so the retry mints a fresh one.
    if (response.status === 401) cachedTokens.delete(scope);

    const retryable = RETRYABLE_HTTP.has(response.status) || response.status === 401;
    if (retryable && attempt === 0) continue;

    const hint = explainStatus(response.status, method);
    throw new SheetsError(
      `Sheets API ${method} failed (HTTP ${response.status})${hint ? ` — ${hint}` : ''}: ${detail}`,
      { retryable, httpStatus: response.status }
    );
  }

  throw new SheetsError('Sheets API retry exhausted', { retryable: true });
}

/** Sheet titles can contain spaces and apostrophes; both need quoting in A1. */
function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

/** "CheckIns!A5:J5" -> 5 */
function rowNumberFromRange(range) {
  const match = /![A-Z]+(\d+)/.exec(range || '');
  return match ? Number(match[1]) : null;
}

/** Column index 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/* ==========================================================================
 * READS (read-only token)
 * ========================================================================== */

/**
 * Reads every populated row of one tab, header row included.
 *
 * Values are read as FORMATTED_VALUE — exactly what an organizer sees in the
 * spreadsheet — so an enrollment number keeps its leading zeros and a semester
 * shows as typed.
 *
 * Google omits trailing empty cells, so rows come back ragged — callers must
 * tolerate short rows.
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName the tab title, e.g. "Form responses 1"
 * @returns {Promise<Array<Array<string>>>} `[]` for an empty tab
 */
export async function getSheetValues(spreadsheetId, sheetName) {
  if (!spreadsheetId) throw new SheetsError('No spreadsheet ID supplied');
  if (!sheetName) throw new SheetsError('No sheet (tab) name supplied');

  const payload = await sheetsRequest(spreadsheetId, `/values/${encodeURIComponent(quoteSheetName(sheetName))}`, {
    query: { majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' },
  });
  return Array.isArray(payload.values) ? payload.values : [];
}

/**
 * True when an error means "that tab does not exist". Google reports a missing
 * tab as a 400 on range parsing rather than a 404, so the message is the only
 * signal available.
 */
export function isMissingSheetError(error) {
  return error?.name === 'SheetsError' && error.httpStatus === 400 && /unable to parse range/i.test(error.message);
}

/* ==========================================================================
 * WRITES (check-in tab only)
 * ========================================================================== */

/**
 * Appends one row to the bottom of the check-in tab.
 *
 * RAW input means a value is stored exactly as given — a name beginning with
 * "=" stays text and can never become a formula. INSERT_ROWS makes Google
 * allocate a new row, so two concurrent appends produce two distinct rows.
 *
 * @returns {Promise<{rowNumber: number|null}>} the 1-based row Google wrote
 */
export async function appendSheetRow(spreadsheetId, sheetName, values) {
  assertWritableTab(sheetName);
  const payload = await sheetsRequest(spreadsheetId, `/values/${encodeURIComponent(quoteSheetName(sheetName))}:append`, {
    method: 'POST',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', includeValuesInResponse: 'false' },
    body: { values: [values] },
  });
  return { rowNumber: rowNumberFromRange(payload?.updates?.updatedRange || '') };
}

/**
 * Overwrites cells inside the check-in tab. Used for two things only: a header
 * row in an empty tab, and marking the losing row of a duplicate race.
 *
 * @param {string} a1Range relative to the tab, e.g. "J12" or "A1:J1"
 */
export async function updateSheetValues(spreadsheetId, sheetName, a1Range, values) {
  assertWritableTab(sheetName);
  const range = `${quoteSheetName(sheetName)}!${a1Range}`;
  await sheetsRequest(spreadsheetId, `/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    query: { valueInputOption: 'RAW' },
    body: { values },
  });
}

const rgb = (hex) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

/**
 * Creates the check-in tab, in one atomic request: the tab itself with a frozen
 * bold header row, plus conditional-formatting rules that colour a whole row by
 * its Method cell — so manual check-ins and walk-ins stand out in the
 * spreadsheet exactly as they do on the dashboard.
 *
 * Every request in the batch targets the new tab's own sheetId; nothing here
 * can reach another tab. Idempotent: if another instance created the tab
 * first, Google's "already exists" is the desired end state and is swallowed.
 *
 * @param {{headers: string[], highlights?: Array<{column: number, equals: string, color: string}>}} layout
 */
export async function createCheckInTab(spreadsheetId, sheetName, { headers, highlights = [] }) {
  assertWritableTab(sheetName);
  const sheetId = crypto.randomInt(100_000_000, 2_000_000_000);
  const width = headers.length;

  const requests = [
    {
      addSheet: {
        properties: { sheetId, title: sheetName, gridProperties: { frozenRowCount: 1, columnCount: Math.max(width, 10) } },
      },
    },
    {
      updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: 0 },
        fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
        rows: [
          {
            values: headers.map((header) => ({
              userEnteredValue: { stringValue: header },
              userEnteredFormat: { textFormat: { bold: true } },
            })),
          },
        ],
      },
    },
    ...highlights.map(({ column, equals, color }, index) => ({
      addConditionalFormatRule: {
        index,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: width }],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=$${columnLetter(column)}2="${equals}"` }],
            },
            format: { backgroundColor: rgb(color) },
          },
        },
      },
    })),
  ];

  try {
    await sheetsRequest(spreadsheetId, ':batchUpdate', { method: 'POST', body: { requests } });
  } catch (error) {
    if (error?.name === 'SheetsError' && /already exists/i.test(error.message)) return;
    throw error;
  }
}

/**
 * The port every consumer depends on. Tests replace these methods with an
 * in-memory fake, which is what lets the whole flow be exercised without a
 * network or a Google project.
 */
export const googleSheets = {
  getSheetValues,
  appendSheetRow,
  updateSheetValues,
  createCheckInTab,
};

/** Test-only: forces the next call to mint fresh access tokens. */
export function __resetTokenCache() {
  cachedTokens.clear();
}
