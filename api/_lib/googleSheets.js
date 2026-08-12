/**
 * The only place in this codebase that talks to Google.
 *
 * Authentication is the standard OAuth 2.0 service-account flow: sign a short
 * JWT with the account's RSA key, exchange it for an access token, cache the
 * token until shortly before it expires. That is roughly sixty lines here and
 * costs nothing at cold start, which is why there is no Google SDK dependency.
 *
 * Nothing in this module is importable from the browser bundle — it lives
 * under api/_lib, is only ever imported by serverless functions, and reads its
 * credentials from non-VITE_ environment variables.
 */

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

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
   *   `retryable` marks a Google-side outage, which the API layer turns into a
   *   503 rather than a 500.
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

export function readConfig() {
  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const spreadsheetId = (process.env.GOOGLE_SHEET_ID || '').trim();

  const missing = [];
  if (!clientEmail) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!privateKey) missing.push('GOOGLE_PRIVATE_KEY');
  if (!spreadsheetId) missing.push('GOOGLE_SHEET_ID');

  if (missing.length) {
    throw new SheetsError(`Missing environment variables: ${missing.join(', ')}`);
  }
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new SheetsError('GOOGLE_PRIVATE_KEY does not look like a PEM private key');
  }

  return { clientEmail, privateKey, spreadsheetId };
}

/** True when the deployment has everything it needs to reach the spreadsheet. */
export function isConfigured() {
  try {
    readConfig();
    return true;
  } catch {
    return false;
  }
}

/** Tab names, overridable for a spreadsheet that uses different titles. */
export const SHEET_NAMES = {
  get registrations() {
    return process.env.SHEET_REGISTRATIONS || 'Registrations';
  },
  get checkIn() {
    return process.env.SHEET_CHECKIN || 'CheckIn';
  },
  get lunch() {
    return process.env.SHEET_LUNCH || 'Lunch';
  },
  get teams() {
    return process.env.SHEET_TEAMS || 'Teams';
  },
};

/* ==========================================================================
 * ACCESS TOKENS
 * ========================================================================== */

// Module scope, so a warm lambda reuses one token across many requests instead
// of paying a round trip per check-in. A cold start simply mints a new one.
let cachedToken = null;

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Signs the assertion Google exchanges for an access token. */
function buildAssertion({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
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

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const config = readConfig();
  const assertion = buildAssertion(config);

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
  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (ttl - TOKEN_SAFETY_WINDOW_SECONDS) * 1000,
  };
  return cachedToken.value;
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

/**
 * One authenticated Sheets API call, with a single retry on transient errors.
 *
 * @param {string} path appended to the spreadsheet URL
 * @param {{method?: string, body?: Object, query?: Object}} [options]
 */
async function sheetsRequest(path, { method = 'GET', body, query } = {}) {
  const { spreadsheetId } = readConfig();
  const url = new URL(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();

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
    if (response.status === 401) cachedToken = null;

    const retryable = RETRYABLE_HTTP.has(response.status) || response.status === 401;
    if (retryable && attempt === 0) continue;

    throw new SheetsError(`Sheets API ${method} ${path} failed (HTTP ${response.status}): ${detail}`, {
      retryable,
      httpStatus: response.status,
    });
  }

  throw new SheetsError('Sheets API retry exhausted', { retryable: true });
}

/* ==========================================================================
 * PUBLIC OPERATIONS
 * ========================================================================== */

/**
 * Reads every populated row of a tab, header row included.
 *
 * Google omits trailing empty cells, so rows come back ragged — callers must
 * read through mapHeaders()/cellFor(), which tolerate short rows.
 *
 * @param {string} sheetName
 * @returns {Promise<Array<Array<string>>>} `[]` for an empty tab
 */
export async function getSheetValues(sheetName) {
  const range = `${quoteSheetName(sheetName)}`;
  const payload = await sheetsRequest(`/values/${encodeURIComponent(range)}`, {
    query: { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' },
  });
  return Array.isArray(payload.values) ? payload.values : [];
}

/**
 * Appends one row to the bottom of a tab.
 *
 * INSERT_ROWS makes Google allocate a brand-new row rather than overwriting
 * anything that happens to sit below the table — the append itself is atomic
 * on Google's side, so two concurrent appends produce two distinct rows and
 * never a lost write. Which of those rows *counts* is settled by the caller;
 * see attendance.js.
 *
 * @returns {Promise<{rowNumber: number|null, updatedRange: string}>} the
 *   1-based row Google actually wrote
 */
export async function appendSheetRow(sheetName, values) {
  const range = quoteSheetName(sheetName);
  const payload = await sheetsRequest(`/values/${encodeURIComponent(range)}:append`, {
    method: 'POST',
    query: {
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      includeValuesInResponse: 'false',
    },
    body: { values: [values] },
  });

  const updatedRange = payload?.updates?.updatedRange || '';
  return { rowNumber: rowNumberFromRange(updatedRange), updatedRange };
}

/**
 * Overwrites a specific range. Used for two things only: writing a header row
 * into an empty tab, and marking a losing row during duplicate reconciliation.
 *
 * @param {string} a1Range e.g. "H12" or "A1:H1", relative to the tab
 */
export async function updateSheetValues(sheetName, a1Range, values) {
  const range = `${quoteSheetName(sheetName)}!${a1Range}`;
  await sheetsRequest(`/values/${encodeURIComponent(range)}`, {
    method: 'PUT',
    query: { valueInputOption: 'RAW' },
    body: { values },
  });
}

/**
 * True when an error means "that tab does not exist", as opposed to any other
 * failure. Google reports a missing tab as a 400 on range parsing rather than
 * a 404, so the message is the only signal available.
 */
export function isMissingSheetError(error) {
  return (
    error?.name === 'SheetsError' &&
    error.httpStatus === 400 &&
    /unable to parse range/i.test(error.message)
  );
}

/**
 * Creates a tab if it is not already there.
 *
 * This is the only code path in the project that changes the *structure* of
 * the spreadsheet, so it is deliberately narrow: it is called only after a
 * read has already failed with "no such tab", it adds nothing but an empty
 * sheet, and it never touches Registrations, CheckIn or Lunch.
 *
 * Idempotent. Two functions racing to create the same tab both succeed —
 * Google rejects the loser with "already exists", which is the desired end
 * state and is therefore swallowed.
 */
export async function ensureSheetExists(sheetName) {
  try {
    await sheetsRequest(':batchUpdate', {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  } catch (error) {
    if (error?.name === 'SheetsError' && /already exists/i.test(error.message)) return;
    throw error;
  }
}

/** Sheet titles can contain spaces and apostrophes; both need quoting in A1. */
function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

/** "CheckIn!A5:H5" -> 5 */
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

/**
 * The port every consumer depends on. Tests pass a fake object with the same
 * methods, which is what lets the whole check-in, lunch and project-upload
 * flow be exercised without a network or a Google project.
 */
export const googleSheets = {
  getSheetValues,
  appendSheetRow,
  updateSheetValues,
  ensureSheetExists,
};

/** Test-only: forces the next call to mint a fresh access token. */
export function __resetTokenCache() {
  cachedToken = null;
}
