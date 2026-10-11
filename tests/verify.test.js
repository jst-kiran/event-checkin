/**
 * POST /api/verify through the real route handler.
 *
 * Only the network is replaced (by a read-only fake holding fictional data):
 * method checks, body parsing, validation, the sheet parser, caching and the
 * status-to-HTTP mapping are all the production code paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION_ROWS, TEST_SHEET_ID, TEST_TAB, FIXTURE_PHONES } from './fixtures/registration-sheet.js';

process.env.REGISTRATION_SHEET_ID = TEST_SHEET_ID;
process.env.REGISTRATION_SHEET_NAME = TEST_TAB;

const verifyRoute = (await import('../api/verify.js')).default;
const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets } = await import('./helpers/fakeSheets.js');
const { __resetRegistrationCache, RegistrationsError } = await import('../api/_lib/registrations.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { SheetsError } = await import('../api/_lib/googleSheets.js');
const { __resetCheckInCache } = await import('../api/_lib/checkins.js');

const CHECKIN_TAB = 'CheckIns';
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

const NOT_FOUND_TEXT =
  'Registration Not Found — Please check the email address or contact the event organizers.';

let restoreSheets = () => {};

/** Fresh fictional sheet, empty cache and no carried-over rate limit. */
function setup(rows = REGISTRATION_ROWS) {
  restoreSheets();
  __resetRegistrationCache();
  __resetCheckInCache();
  __resetRateLimits();
  // The fake refuses any write to the registration tab, on top of the real guard.
  const fake = createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: rows } }, { readOnlyTabs: [TEST_TAB] });
  restoreSheets = installFakeSheets(fake);
  return fake;
}

const post = (body, headers) => call(verifyRoute, { method: 'POST', url: '/api/verify', body, headers });

/** Asserts a response body carries no phone number, no email and no list. */
function assertNothingSensitive(res) {
  const raw = res.body || '';
  for (const phone of FIXTURE_PHONES) assert.equal(raw.includes(phone), false, 'phone number leaked');
  assert.equal(raw.includes('@'), false, 'an email address leaked');
  const json = res.json();
  assert.equal(Array.isArray(json), false);
  for (const value of Object.values(json)) assert.equal(Array.isArray(value), false, 'a list leaked');
}

test('a registered email returns 200 with the five display fields and checks the person in', async () => {
  const fake = setup();
  const res = await post({ email: 'asha.verma@example.com' });

  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.deepEqual(Object.keys(json).sort(), ['attendee', 'checkIn', 'status', 'success']);
  assert.equal(json.status, 'REGISTRATION_VERIFIED');
  assert.deepEqual(json.attendee, {
    fullName: 'Asha Verma',
    enrollmentNumber: 'EN2026001',
    semester: '3',
    course: 'B.Tech',
    specialization: 'Data Science',
  });
  assert.equal(json.checkIn.status, 'CHECKED_IN');
  assert.equal(json.checkIn.method, 'Desk');
  assert.match(json.checkIn.checkedInAt, ISO_WITH_OFFSET);
  assertNothingSensitive(res);

  // One row in the CheckIns tab, created on first use; nothing else written.
  const rows = fake.rows(TEST_SHEET_ID, CHECKIN_TAB);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].slice(1), ['asha.verma@example.com', 'Asha Verma', 'EN2026001', '3', 'B.Tech', 'Data Science', 'Desk', 'Desk', 'Checked In']);
  assert.ok(fake.calls.writes.every((w) => w.sheetName === CHECKIN_TAB));
});

test('verifying the same person again says when they were already checked in', async () => {
  const fake = setup();
  const first = (await post({ email: 'asha.verma@example.com' })).json();
  const again = await post({ email: '  ASHA.VERMA@example.com ' });

  assert.equal(again.statusCode, 200);
  assert.equal(again.json().status, 'REGISTRATION_VERIFIED');
  assert.equal(again.json().checkIn.status, 'ALREADY_CHECKED_IN');
  assert.equal(again.json().checkIn.checkedInAt, first.checkIn.checkedInAt);
  assert.equal(fake.rows(TEST_SHEET_ID, CHECKIN_TAB).length, 2, 'no second row');
});

test('a double-tap (two simultaneous requests) records one check-in', async () => {
  const fake = setup();
  const results = await Promise.all([post({ email: 'meera@example.com' }), post({ email: 'meera@example.com' })]);
  const statuses = results.map((r) => r.json().checkIn.status).sort();
  assert.deepEqual(statuses, ['ALREADY_CHECKED_IN', 'CHECKED_IN']);
  assert.equal(fake.rows(TEST_SHEET_ID, CHECKIN_TAB).length, 2);
});

test('if the check-in cannot be saved the desk is told to retry — not "verified"', async () => {
  const fake = setup();
  fake.failWritesWith(new SheetsError('Sheets API POST failed (HTTP 403) — permission denied', { httpStatus: 403 }));
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await post({ email: 'asha.verma@example.com' });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().status, 'CHECK_IN_UNAVAILABLE');
    assert.equal(res.json().attendee, undefined);
    assert.equal(res.body.includes('403'), false);
  } finally {
    console.error = originalError;
  }
});

test('different capitalization and accidental spaces still verify', async () => {
  setup();
  for (const email of ['ASHA.VERMA@EXAMPLE.COM', '   asha.verma@example.com   ', '\tAsha.Verma@Example.Com\n', ' asha.verma@example.com']) {
    const res = await post({ email });
    assert.equal(res.statusCode, 200, `failed for ${JSON.stringify(email)}`);
    assert.equal(res.json().attendee.fullName, 'Asha Verma');
  }
});

test('an unregistered email returns 404 with the exact not-found message', async () => {
  setup();
  const res = await post({ email: 'nobody@example.com' });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), {
    success: false,
    status: 'REGISTRATION_NOT_FOUND',
    message: NOT_FOUND_TEXT,
  });
});

test('an email shared by two different people returns 409 and no details', async () => {
  setup();
  const res = await post({ email: 'shared@example.com' });

  assert.equal(res.statusCode, 409);
  assert.equal(res.json().status, 'DUPLICATE_REGISTRATION');
  assert.equal(res.json().attendee, undefined);
  assert.equal(res.body.includes('Arjun'), false);
  assert.equal(res.body.includes('Divya'), false);
});

test('an identical repeat submission verifies once, normally', async () => {
  setup();
  const res = await post({ email: 'rohan.mehta@example.org' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().attendee.fullName, 'Rohan Mehta');
});

test('a blank detail is returned as an empty string, not invented', async () => {
  setup();
  const res = await post({ email: 'meera@example.com' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().attendee.specialization, '');
});

test('empty input returns 400 EMAIL_REQUIRED', async () => {
  for (const body of [{ email: '' }, { email: '   ' }, { email: ' ' }, {}, { email: null }]) {
    setup();
    const res = await post(body);
    assert.equal(res.statusCode, 400, `failed for ${JSON.stringify(body)}`);
    assert.equal(res.json().status, 'EMAIL_REQUIRED');
  }
});

test('an invalid email format returns 400 INVALID_EMAIL without reading the sheet', async () => {
  const fake = setup();
  for (const email of ['not-an-email', 'a@b', 'two@@example.com', 'has space@example.com', 'x'.repeat(250) + '@example.com']) {
    const res = await post({ email });
    assert.equal(res.statusCode, 400, `failed for ${email}`);
    assert.equal(res.json().status, 'INVALID_EMAIL');
  }
  assert.equal(fake.calls.get, 0);
});

test('a non-string email is refused — an array cannot pose as an address', async () => {
  setup();
  for (const email of [['asha.verma@example.com'], { a: 1 }, 42, true]) {
    const res = await post({ email });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().status, 'INVALID_EMAIL');
  }
});

test('malformed JSON and oversized bodies are refused with 400', async () => {
  setup();
  let res = await call(verifyRoute, { method: 'POST', rawBody: '{"email": ' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().status, 'INVALID_REQUEST');

  res = await call(verifyRoute, { method: 'POST', rawBody: JSON.stringify({ email: 'a'.repeat(10_000) }) });
  assert.equal(res.statusCode, 400);

  res = await call(verifyRoute, { method: 'POST', rawBody: '["asha.verma@example.com"]' });
  assert.equal(res.statusCode, 400);
});

test('only POST is allowed', async () => {
  setup();
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = await call(verifyRoute, { method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.allow, 'POST');
  }
});

/* ==========================================================================
 * A failed data source is an outage, never "not registered"
 * ========================================================================== */

async function assertUnavailable(res) {
  assert.equal(res.statusCode, 503);
  const json = res.json();
  assert.equal(json.status, 'REGISTRATION_DATA_UNAVAILABLE');
  assert.notEqual(json.status, 'REGISTRATION_NOT_FOUND');
  // Nothing internal crosses the boundary.
  for (const secret of ['HTTP', 'Sheets', 'GOOGLE_', 'REGISTRATION_SHEET', TEST_SHEET_ID, 'stack', 'Error']) {
    assert.equal(res.body.includes(secret), false, `leaked ${secret}`);
  }
}

test('Google unreachable → 503, for registered and unregistered emails alike', async () => {
  const fake = setup();
  fake.failWith(new SheetsError('Could not reach Google: ECONNRESET', { retryable: true }));
  const originalError = console.error;
  console.error = () => {};
  try {
    await assertUnavailable(await post({ email: 'asha.verma@example.com' }));
    await assertUnavailable(await post({ email: 'nobody@example.com' }));
  } finally {
    console.error = originalError;
  }
});

test('sheet not shared with the service account (403) → 503, not 404', async () => {
  const fake = setup();
  fake.failWith(new SheetsError('Sheets API read failed (HTTP 403) — permission denied', { httpStatus: 403 }));
  const originalError = console.error;
  console.error = () => {};
  try {
    await assertUnavailable(await post({ email: 'nobody@example.com' }));
  } finally {
    console.error = originalError;
  }
});

test('missing columns or malformed data → 503, not a false result', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    setup([['Timestamp', 'Full Name', 'Phone number'], ['x', 'Someone', '9000000000']]);
    await assertUnavailable(await post({ email: 'asha.verma@example.com' }));

    setup([REGISTRATION_ROWS[0]]); // header only — wrong tab or wiped sheet
    await assertUnavailable(await post({ email: 'asha.verma@example.com' }));
  } finally {
    console.error = originalError;
  }
});

test('an unconfigured deployment → 503, never falls back to another source', async () => {
  setup();
  const saved = process.env.REGISTRATION_SHEET_ID;
  delete process.env.REGISTRATION_SHEET_ID;
  process.env.GOOGLE_SHEET_ID = '1AnOldEventSheetIdThatMustNeverBeRead0000';
  const originalError = console.error;
  console.error = () => {};
  try {
    __resetRegistrationCache();
    await assertUnavailable(await post({ email: 'asha.verma@example.com' }));
  } finally {
    console.error = originalError;
    process.env.REGISTRATION_SHEET_ID = saved;
    delete process.env.GOOGLE_SHEET_ID;
  }
});

test('the error log names the cause for the operator', async () => {
  const fake = setup();
  fake.failWith(new RegistrationsError('Required column(s) not found: Course', 'MALFORMED_DATA'));
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await post({ email: 'asha.verma@example.com' });
  } finally {
    console.error = originalError;
  }
  assert.match(logged.join('\n'), /MALFORMED_DATA.*Course/);
});

/* ==========================================================================
 * Read-only, private, rate-limited
 * ========================================================================== */

test('the registration tab is never written; unregistered and conflicting emails write nothing', async () => {
  const fake = setup();
  for (const email of ['nobody@example.com', 'shared@example.com', 'not-an-email']) await post({ email });
  assert.equal(fake.calls.writes.length, 0, 'nothing written for not-found / conflict / invalid');

  await post({ email: 'asha.verma@example.com' });
  assert.ok(fake.calls.writes.length > 0);
  assert.ok(fake.calls.writes.every((w) => w.sheetName === CHECKIN_TAB && w.spreadsheetId === TEST_SHEET_ID));
  assert.deepEqual(fake.rows(TEST_SHEET_ID, TEST_TAB), REGISTRATION_ROWS, 'registration tab unchanged');
});

test('no phone number is ever written to the check-in tab', async () => {
  const fake = setup();
  for (const email of ['asha.verma@example.com', 'rohan.mehta@example.org', 'neha@example.com']) await post({ email });
  const written = JSON.stringify(fake.rows(TEST_SHEET_ID, CHECKIN_TAB));
  for (const phone of FIXTURE_PHONES) assert.equal(written.includes(phone), false);
});

test('no response ever contains a phone number, an email or the registration list', async () => {
  setup();
  for (const email of ['asha.verma@example.com', 'neha@example.com', 'meera@example.com', 'nobody@example.com', 'shared@example.com']) {
    assertNothingSensitive(await post({ email }));
  }
});

test('responses forbid caching', async () => {
  setup();
  for (const email of ['asha.verma@example.com', 'nobody@example.com']) {
    const res = await post({ email });
    assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
});

test('a flood from one client is rate-limited', async () => {
  setup();
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const res = await post({ email: `probe${i}@example.com` }, { 'x-forwarded-for': '203.0.113.9' });
    if (res.statusCode === 429) limited = res;
  }
  assert.ok(limited, 'expected a 429');
  assert.equal(limited.json().status, 'RATE_LIMITED');
  assert.ok(Number(limited.headers['retry-after']) > 0);

  // A different client is unaffected.
  const other = await post({ email: 'asha.verma@example.com' }, { 'x-forwarded-for': '203.0.113.10' });
  assert.equal(other.statusCode, 200);
});

test.after(() => restoreSheets());
