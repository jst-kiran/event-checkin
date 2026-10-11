/**
 * The organizer area through the real route handlers: sign-in, the attendee
 * list with check-in status, manual check-in and walk-ins. Only the network is
 * replaced, by a fake holding fictional data that refuses any write to the
 * registration tab.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION_ROWS, TEST_SHEET_ID, TEST_TAB, FIXTURE_PHONES } from './fixtures/registration-sheet.js';

process.env.REGISTRATION_SHEET_ID = TEST_SHEET_ID;
process.env.REGISTRATION_SHEET_NAME = TEST_TAB;
delete process.env.CHECKIN_SHEET_NAME;
process.env.SESSION_SECRET = 'test-session-secret-value-long-enough';
process.env.ADMIN_EMAIL = 'organizer@example.com';
process.env.ADMIN_PASSWORD = 'correct horse battery staple';

const loginRoute = (await import('../api/admin/login.js')).default;
const logoutRoute = (await import('../api/admin/logout.js')).default;
const sessionRoute = (await import('../api/admin/session.js')).default;
const attendeesRoute = (await import('../api/admin/attendees.js')).default;
const verifyRoute = (await import('../api/verify.js')).default;
const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets } = await import('./helpers/fakeSheets.js');
const { __resetRegistrationCache } = await import('../api/_lib/registrations.js');
const { __resetCheckInCache } = await import('../api/_lib/checkins.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');

const CHECKIN_TAB = 'CheckIns';
let restoreSheets = () => {};

function setup() {
  restoreSheets();
  __resetRegistrationCache();
  __resetCheckInCache();
  __resetRateLimits();
  const fake = createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: REGISTRATION_ROWS } }, { readOnlyTabs: [TEST_TAB] });
  restoreSheets = installFakeSheets(fake);
  return fake;
}

const auth = () => ({ cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}` });
const post = (handler, body, headers) => call(handler, { method: 'POST', url: '/api/x', body, headers });
const list = async () => {
  __resetCheckInCache(); // the dashboard cache is 5 s; tests want the latest rows
  const res = await call(attendeesRoute, { method: 'GET', url: '/api/admin/attendees', headers: auth() });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const row = (data, email) => [...data.attendees, ...data.walkIns].find((r) => r.email === email);

/* ==========================================================================
 * Sign-in
 * ========================================================================== */

test('login succeeds with the right credentials and sets an HttpOnly, SameSite=Strict cookie', async () => {
  setup();
  const res = await post(loginRoute, { email: 'Organizer@Example.com', password: 'correct horse battery staple' });
  assert.equal(res.statusCode, 200);
  const cookie = res.getHeader('set-cookie');
  assert.match(cookie, /^admin_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('login refuses wrong credentials without saying which part was wrong', async () => {
  setup();
  const wrongPassword = await post(loginRoute, { email: 'organizer@example.com', password: 'nope' });
  __resetRateLimits();
  const wrongEmail = await post(loginRoute, { email: 'someone@example.com', password: 'correct horse battery staple' });
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(wrongPassword.json(), wrongEmail.json());
  assert.equal(wrongPassword.getHeader('set-cookie'), undefined);
});

test('login is throttled against guessing', async () => {
  setup();
  let limited = null;
  for (let i = 0; i < 20 && !limited; i++) {
    const res = await post(loginRoute, { email: 'organizer@example.com', password: `guess-${i}` });
    if (res.statusCode === 429) limited = res;
  }
  assert.ok(limited);
});

test('session reports 401 when anonymous and 200 when signed in; logout clears the cookie', async () => {
  setup();
  assert.equal((await call(sessionRoute, { method: 'GET' })).statusCode, 401);
  const signedIn = await call(sessionRoute, { method: 'GET', headers: auth() });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.json().email, 'organizer@example.com');
  assert.match((await call(logoutRoute, { method: 'POST' })).getHeader('set-cookie'), /Max-Age=0/);
});

test('the attendee list and both actions refuse anonymous and forged sessions', async () => {
  const fake = setup();
  const forged = [
    undefined,
    { cookie: 'admin_session=made.up' },
    { cookie: `admin_session=${createSessionToken('organizer@example.com').slice(0, -3)}xyz` },
  ];
  for (const headers of forged) {
    const get = await call(attendeesRoute, { method: 'GET', headers });
    assert.equal(get.statusCode, 401);
    assert.equal(get.body.includes('example.com'), false, 'nothing about attendees in a 401');
    const act = await call(attendeesRoute, { method: 'POST', headers, body: { action: 'walk-in', fullName: 'X', email: 'x@example.com' } });
    assert.equal(act.statusCode, 401);
  }
  assert.equal(fake.calls.get, 0);
  assert.equal(fake.calls.writes.length, 0);
});

test('only GET and POST are allowed', async () => {
  setup();
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal((await call(attendeesRoute, { method, headers: auth() })).statusCode, 405);
  }
});

/* ==========================================================================
 * The list
 * ========================================================================== */

test('the list shows every registration with status, in sheet order, and never a phone number', async () => {
  setup();
  const data = await list();

  assert.equal(data.summary.totalRegistrations, 6);
  assert.equal(data.summary.checkedIn, 0);
  assert.equal(data.summary.notCheckedIn, 6);
  assert.equal(data.summary.walkIns, 0);
  assert.deepEqual(
    data.attendees.map((a) => a.email),
    ['asha.verma@example.com', 'rohan.mehta@example.org', 'meera@example.com', 'neha@example.com', 'shared@example.com', 'vikram@example.com']
  );
  const asha = row(data, 'asha.verma@example.com');
  assert.deepEqual(asha, {
    email: 'asha.verma@example.com',
    rowNumbers: [2],
    conflict: false,
    walkIn: false,
    fullName: 'Asha Verma',
    enrollmentNumber: 'EN2026001',
    semester: '3',
    course: 'B.Tech',
    specialization: 'Data Science',
    checkedIn: false,
    checkedInAt: '',
    method: '',
    checkedInBy: '',
  });
  assert.equal(row(data, 'shared@example.com').conflict, true);

  const raw = JSON.stringify(data);
  for (const phone of FIXTURE_PHONES) assert.equal(raw.includes(phone), false, 'phone number leaked');

  // Sheet health, by row number.
  assert.deepEqual(data.sheet.rejectedRows.map((r) => r.rowNumber), [5, 6]);
  assert.equal(data.sheet.checkInTabExists, false);
  assert.equal(data.sheet.registrationTab, TEST_TAB);
});

test('desk, manual and walk-in check-ins appear with their time and method', async () => {
  const fake = setup();

  await post(verifyRoute, { email: 'asha.verma@example.com' }); // desk
  const manual = await post(attendeesRoute, { action: 'check-in', email: 'MEERA@example.com' }, auth());
  assert.equal(manual.statusCode, 200);
  assert.equal(manual.json().status, 'CHECKED_IN');
  assert.equal(manual.json().attendee.method, 'Manual');

  const walkIn = await post(
    attendeesRoute,
    { action: 'walk-in', fullName: '  Kiran   Rao ', email: 'Kiran.Rao@Example.com', course: 'BCA', semester: '1' },
    auth()
  );
  assert.equal(walkIn.statusCode, 200, walkIn.body);
  assert.equal(walkIn.json().status, 'CHECKED_IN');
  assert.equal(walkIn.json().attendee.fullName, 'Kiran Rao');

  const data = await list();
  assert.equal(data.summary.checkedIn, 2);
  assert.equal(data.summary.deskCheckIns, 1);
  assert.equal(data.summary.manualCheckIns, 1);
  assert.equal(data.summary.walkIns, 1);
  assert.equal(data.summary.totalPresent, 3);

  assert.equal(row(data, 'asha.verma@example.com').method, 'Desk');
  assert.equal(row(data, 'meera@example.com').method, 'Manual');
  assert.equal(row(data, 'meera@example.com').checkedInBy, 'organizer@example.com');
  const kiran = row(data, 'kiran.rao@example.com');
  assert.equal(kiran.walkIn, true);
  assert.equal(kiran.method, 'Walk-in');
  assert.equal(kiran.course, 'BCA');
  for (const r of [row(data, 'asha.verma@example.com'), row(data, 'meera@example.com'), kiran]) {
    assert.match(r.checkedInAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  }

  // In the sheet: Method column drives the highlight colours.
  const methods = fake.rows(TEST_SHEET_ID, CHECKIN_TAB).slice(1).map((r) => r[7]);
  assert.deepEqual(methods, ['Desk', 'Manual', 'Walk-in']);
  assert.ok(fake.calls.writes.every((w) => w.sheetName === CHECKIN_TAB));
  assert.deepEqual(fake.rows(TEST_SHEET_ID, TEST_TAB), REGISTRATION_ROWS, 'registration tab untouched');
});

test('a manual check-in of someone already checked in reports the original time', async () => {
  setup();
  const desk = (await post(verifyRoute, { email: 'neha@example.com' })).json();
  const manual = await post(attendeesRoute, { action: 'check-in', email: 'neha@example.com' }, auth());
  assert.equal(manual.json().status, 'ALREADY_CHECKED_IN');
  assert.equal(manual.json().attendee.checkedInAt, desk.checkIn.checkedInAt);
  assert.equal(manual.json().attendee.method, 'Desk');
});

test('manual check-in only works for registered emails; walk-ins only for unregistered ones', async () => {
  const fake = setup();
  const notRegistered = await post(attendeesRoute, { action: 'check-in', email: 'stranger@example.com' }, auth());
  assert.equal(notRegistered.statusCode, 404);

  const alreadyRegistered = await post(
    attendeesRoute,
    { action: 'walk-in', fullName: 'Asha', email: 'asha.verma@example.com' },
    auth()
  );
  assert.equal(alreadyRegistered.statusCode, 409);
  assert.equal(alreadyRegistered.json().status, 'ALREADY_REGISTERED');
  assert.equal(fake.calls.writes.length, 0);
});

test('a conflicting-duplicate email can still be checked in manually by an organizer', async () => {
  setup();
  const res = await post(attendeesRoute, { action: 'check-in', email: 'shared@example.com' }, auth());
  assert.equal(res.statusCode, 200);
  const data = await list();
  assert.equal(row(data, 'shared@example.com').checkedIn, true);
  assert.equal(row(data, 'shared@example.com').method, 'Manual');
});

test('walk-in input is validated', async () => {
  const fake = setup();
  const cases = [
    [{ action: 'walk-in', email: 'a@example.com' }, 400],
    [{ action: 'walk-in', fullName: '   ', email: 'a@example.com' }, 400],
    [{ action: 'walk-in', fullName: 'A', email: 'not-an-email' }, 400],
    [{ action: 'walk-in', fullName: 'A', email: ['a@example.com'] }, 400],
    [{ action: 'walk-in', fullName: 'x'.repeat(121), email: 'a@example.com' }, 400],
    [{ action: 'walk-in', fullName: 'A', email: 'a@example.com', course: { $gt: '' } }, 400],
    [{ action: 'delete-everything', email: 'a@example.com' }, 400],
  ];
  for (const [body, status] of cases) {
    const res = await post(attendeesRoute, body, auth());
    assert.equal(res.statusCode, status, JSON.stringify(body));
  }
  assert.equal(fake.calls.writes.length, 0);
});

test('a value that looks like a formula is stored as plain text', async () => {
  const fake = setup();
  await post(attendeesRoute, { action: 'walk-in', fullName: '=HYPERLINK("http://evil")', email: 'f@example.com' }, auth());
  const append = fake.calls.writes.find((w) => w.kind === 'append');
  assert.equal(append.payload[2], '=HYPERLINK("http://evil")');
  // The real client sends every append with valueInputOption=RAW, so Google
  // stores this as text — see tests/googleSheets.test.js.
});

test('if the sheet cannot be read the dashboard gets 503, never an empty list', async () => {
  const fake = setup();
  fake.failWith(new Error('network down'));
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await call(attendeesRoute, { method: 'GET', headers: auth() });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().attendees, undefined);
  } finally {
    console.error = originalError;
  }
});

test.after(() => restoreSheets());
