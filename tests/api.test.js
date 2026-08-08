/**
 * End-to-end tests through the real route handlers.
 *
 * Only the network is replaced: routing, method checks, body parsing,
 * validation, the concurrency engine and the status-to-HTTP mapping are all the
 * production code paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');
process.env.SESSION_SECRET = 'test-session-secret-value-long-enough';
process.env.ADMIN_EMAIL = 'organizer@example.com';
process.env.ADMIN_PASSWORD = 'correct horse battery staple';

const checkinRoute = (await import('../api/checkin.js')).default;
const lunchRoute = (await import('../api/lunch.js')).default;
const loginRoute = (await import('../api/admin/login.js')).default;
const logoutRoute = (await import('../api/admin/logout.js')).default;
const sessionRoute = (await import('../api/admin/session.js')).default;
const statsRoute = (await import('../api/admin/stats.js')).default;
const checkinsRoute = (await import('../api/admin/checkins.js')).default;
const teamsRoute = (await import('../api/admin/teams.js')).default;

const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets, EMPTY_SHEETS } = await import('./helpers/fakeSheets.js');
const { __resetReadCache } = await import('../api/_lib/attendance.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');
const { SheetsError } = await import('../api/_lib/googleSheets.js');

let restoreSheets = () => {};

/** Fresh spreadsheet, empty caches and no carried-over rate limit. */
function setup(initial = EMPTY_SHEETS) {
  restoreSheets();
  __resetReadCache();
  __resetRateLimits();

  const fake = createFakeSheets(initial);
  restoreSheets = installFakeSheets(fake);
  return fake;
}

const authCookie = () => ({
  cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}`,
});

const post = (handler, body, headers) =>
  call(handler, { method: 'POST', url: '/api/x', body, headers });

/* ==========================================================================
 * POST /api/checkin
 * ========================================================================== */

test('POST /api/checkin returns 200 for a registered attendee', async () => {
  setup();
  const res = await post(checkinRoute, { email: 'john@example.com' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    success: true,
    status: 'CHECKED_IN',
    attendee: { name: 'John Doe', email: 'john@example.com', mealPreference: 'Jain Veg Meal' },
  });
});

test('POST /api/checkin returns 409 on the second attempt', async () => {
  setup();
  await post(checkinRoute, { email: 'john@example.com' });
  __resetReadCache();

  const res = await post(checkinRoute, { email: 'JOHN@EXAMPLE.COM ' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().status, 'ALREADY_CHECKED_IN');
  assert.equal(res.json().attendee.name, 'John Doe');
});

test('POST /api/checkin returns 404 for an unregistered email and reveals nothing', async () => {
  setup();
  const res = await post(checkinRoute, { email: 'nobody@example.com' });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().status, 'REGISTRATION_NOT_FOUND');
  // No attendee object: the endpoint must not become a guest-list oracle.
  assert.equal(res.json().attendee, undefined);
});

test('POST /api/checkin rejects malformed input with 400', async () => {
  setup();

  const cases = [
    [{}, 'INVALID_EMAIL'],
    [{ email: '' }, 'INVALID_EMAIL'],
    [{ email: 'not-an-email' }, 'INVALID_EMAIL'],
    [{ email: 'john@' }, 'INVALID_EMAIL'],
    [{ email: null }, 'INVALID_EMAIL'],
    [{ email: 12345 }, 'INVALID_EMAIL'],
    [{ email: { nested: true } }, 'INVALID_EMAIL'],
    [{ email: ['john@example.com'] }, 'INVALID_EMAIL'],
  ];

  for (const [body, expected] of cases) {
    const res = await post(checkinRoute, body);
    assert.equal(res.statusCode, 400, `for ${JSON.stringify(body)}`);
    assert.equal(res.json().status, expected);
  }
});

test('POST /api/checkin rejects a body that is not a JSON object', async () => {
  setup();

  for (const rawBody of ['{ broken', '[1,2,3]', '"a string"', '42', 'null']) {
    const res = await call(checkinRoute, { method: 'POST', url: '/api/checkin', rawBody });
    assert.equal(res.statusCode, 400, `for ${rawBody}`);
    assert.equal(res.json().status, 'INVALID_REQUEST');
  }
});

test('POST /api/checkin refuses an oversized body without buffering it', async () => {
  setup();
  const rawBody = JSON.stringify({ email: 'john@example.com', padding: 'x'.repeat(20000) });

  const res = await call(checkinRoute, { method: 'POST', url: '/api/checkin', rawBody });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().status, 'INVALID_REQUEST');
});

test('POST /api/checkin refuses an over-long email', async () => {
  setup();
  const res = await post(checkinRoute, { email: `${'a'.repeat(250)}@example.com` });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().status, 'INVALID_EMAIL');
});

test('/api/checkin allows only POST', async () => {
  setup();

  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const res = await call(checkinRoute, { method, url: '/api/checkin' });
    assert.equal(res.statusCode, 405, `for ${method}`);
    assert.equal(res.json().status, 'METHOD_NOT_ALLOWED');
    assert.equal(res.getHeader('allow'), 'POST');
  }
});

test('POST /api/checkin returns 503 when Google is unreachable, leaking nothing', async () => {
  const fake = setup();
  fake.failWith(new SheetsError('Sheets API GET failed: caller lacks permission', { retryable: true }));

  const res = await post(checkinRoute, { email: 'john@example.com' });
  const payload = res.json();

  assert.equal(res.statusCode, 503);
  assert.equal(payload.status, 'SERVICE_UNAVAILABLE');

  // The operator-facing message must not carry Google's wording, a stack, or
  // anything about our configuration.
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['permission', 'Sheets API', 'GOOGLE_', 'at Object', '.js:']) {
    assert.equal(serialized.includes(forbidden), false, `leaked "${forbidden}"`);
  }
});

test('POST /api/checkin returns 500 for an unexpected internal failure', async () => {
  const fake = setup();
  fake.failWith(new Error('something broke in our own code'));

  const res = await post(checkinRoute, { email: 'john@example.com' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().status, 'INTERNAL_ERROR');
  assert.equal(res.json().message, 'Unable to process request. Please try again.');
});

test('POST /api/checkin rate-limits a flood from one client', async () => {
  setup();

  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) {
    const res = await post(checkinRoute, { email: 'nobody@example.com' });
    if (res.statusCode === 429) limited = res;
  }

  assert.ok(limited, 'expected a 429 within 40 requests');
  assert.equal(limited.json().status, 'RATE_LIMITED');
  assert.ok(Number(limited.getHeader('retry-after')) > 0);
});

test('every /api/checkin response forbids caching', async () => {
  setup();
  const res = await post(checkinRoute, { email: 'john@example.com' });

  assert.match(res.getHeader('cache-control'), /no-store/);
  assert.equal(res.getHeader('x-content-type-options'), 'nosniff');
});

/* ==========================================================================
 * POST /api/lunch
 * ========================================================================== */

test('POST /api/lunch returns 200 after a check-in', async () => {
  setup();
  await post(checkinRoute, { email: 'john@example.com' });
  __resetReadCache();

  const res = await post(lunchRoute, { email: 'john@example.com' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'LUNCH_APPROVED');
  assert.equal(res.json().attendee.mealPreference, 'Jain Veg Meal');
});

test('POST /api/lunch returns 403 when the attendee has not checked in', async () => {
  setup();
  const res = await post(lunchRoute, { email: 'john@example.com' });

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().status, 'PLEASE_CHECK_IN_FIRST');
});

test('POST /api/lunch returns 409 on a second claim', async () => {
  setup();
  await post(checkinRoute, { email: 'priya@example.com' });
  __resetReadCache();
  await post(lunchRoute, { email: 'priya@example.com' });
  __resetReadCache();

  const res = await post(lunchRoute, { email: 'priya@example.com' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().status, 'ALREADY_CLAIMED');
});

test('POST /api/lunch returns 404 for an unregistered email', async () => {
  setup();
  const res = await post(lunchRoute, { email: 'nobody@example.com' });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().status, 'REGISTRATION_NOT_FOUND');
});

test('POST /api/lunch ignores a meal preference supplied by the caller', async () => {
  const fake = setup();
  await post(checkinRoute, { email: 'priya@example.com' });
  __resetReadCache();

  const res = await post(lunchRoute, {
    email: 'priya@example.com',
    mealPreference: 'Jain Veg Meal',
  });

  assert.equal(res.json().attendee.mealPreference, 'Veg Meal');
  assert.equal(fake.rows('Lunch')[1][3], 'Veg Meal');
});

test('/api/lunch allows only POST', async () => {
  setup();
  const res = await call(lunchRoute, { method: 'GET', url: '/api/lunch' });

  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader('allow'), 'POST');
});

/* ==========================================================================
 * ADMIN AUTH
 * ========================================================================== */

test('POST /api/admin/login succeeds and sets an HttpOnly cookie', async () => {
  setup();
  const res = await post(loginRoute, {
    email: 'organizer@example.com',
    password: 'correct horse battery staple',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().success, true);

  const cookie = res.getHeader('set-cookie');
  assert.match(cookie, /^admin_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('POST /api/admin/login returns 401 for wrong credentials, with no cookie', async () => {
  setup();

  for (const body of [
    { email: 'organizer@example.com', password: 'wrong' },
    { email: 'attacker@example.com', password: 'correct horse battery staple' },
  ]) {
    __resetRateLimits();
    const res = await post(loginRoute, body);
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().status, 'INVALID_CREDENTIALS');
    assert.equal(res.getHeader('set-cookie'), undefined);
  }
});

test('POST /api/admin/login returns 400 for empty or missing fields', async () => {
  setup();

  for (const body of [{}, { email: '' }, { password: '' }, { email: 'a@b.com' }, { email: 1, password: 2 }]) {
    __resetRateLimits();
    const res = await post(loginRoute, body);
    assert.equal(res.statusCode, 400, `for ${JSON.stringify(body)}`);
    assert.equal(res.json().status, 'INVALID_REQUEST');
  }
});

test('POST /api/admin/login never says which field was wrong', async () => {
  setup();
  const wrongEmail = await post(loginRoute, { email: 'nobody@example.com', password: 'x' });
  __resetRateLimits();
  const wrongPassword = await post(loginRoute, { email: 'organizer@example.com', password: 'x' });

  assert.deepEqual(wrongEmail.json(), wrongPassword.json());
});

test('POST /api/admin/login throttles guessing', async () => {
  setup();

  let limited = null;
  for (let i = 0; i < 20 && !limited; i++) {
    const res = await post(loginRoute, { email: 'organizer@example.com', password: `guess-${i}` });
    if (res.statusCode === 429) limited = res;
  }

  assert.ok(limited, 'expected a 429 within 20 guesses');
  assert.equal(limited.json().status, 'RATE_LIMITED');
});

test('/api/admin/login allows only POST', async () => {
  setup();
  const res = await call(loginRoute, { method: 'GET', url: '/api/admin/login' });
  assert.equal(res.statusCode, 405);
});

test('GET /api/admin/session reports 401 when anonymous and 200 when signed in', async () => {
  setup();

  const anonymous = await call(sessionRoute, { method: 'GET', url: '/api/admin/session' });
  assert.equal(anonymous.statusCode, 401);

  const signedIn = await call(sessionRoute, {
    method: 'GET',
    url: '/api/admin/session',
    headers: authCookie(),
  });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.json().email, 'organizer@example.com');
});

test('POST /api/admin/logout clears the cookie', async () => {
  setup();
  const res = await call(logoutRoute, { method: 'POST', url: '/api/admin/logout' });

  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);
});

/* ==========================================================================
 * PROTECTED ADMIN ROUTES
 * ========================================================================== */

const PROTECTED = [
  ['stats', statsRoute, '/api/admin/stats'],
  ['checkins', checkinsRoute, '/api/admin/checkins'],
  ['teams', teamsRoute, '/api/admin/teams?teams=3'],
];

test('every admin data route refuses an anonymous caller', async () => {
  setup();

  for (const [name, handler, url] of PROTECTED) {
    const res = await call(handler, { method: 'GET', url });
    assert.equal(res.statusCode, 401, `${name} should be protected`);
    assert.equal(res.json().status, 'UNAUTHORIZED');
    // Nothing about the event may appear in a 401 body.
    assert.equal(res.body.includes('example.com'), false);
  }
});

test('every admin data route refuses a forged or expired cookie', async () => {
  setup();

  const forged = [
    'admin_session=made.up',
    'admin_session=',
    `admin_session=${createSessionToken('organizer@example.com').slice(0, -3)}xyz`,
    'admin_session=' + Buffer.from('{"sub":"x","exp":9999999999}').toString('base64url') + '.sig',
  ];

  for (const [name, handler, url] of PROTECTED) {
    for (const cookie of forged) {
      const res = await call(handler, { method: 'GET', url, headers: { cookie } });
      assert.equal(res.statusCode, 401, `${name} accepted "${cookie}"`);
    }
  }
});

test('admin routes reject the wrong HTTP method even when authenticated', async () => {
  setup();

  for (const [name, handler, url] of PROTECTED) {
    const res = await call(handler, { method: 'POST', url, headers: authCookie() });
    assert.equal(res.statusCode, 405, `${name} should refuse POST`);
  }
});

test('GET /api/admin/stats returns live counts for a signed-in organizer', async () => {
  setup();
  await post(checkinRoute, { email: 'john@example.com' });
  await post(checkinRoute, { email: 'priya@example.com' });
  __resetReadCache();
  await post(lunchRoute, { email: 'john@example.com' });
  __resetReadCache();

  const res = await call(statsRoute, {
    method: 'GET',
    url: '/api/admin/stats',
    headers: authCookie(),
  });

  assert.equal(res.statusCode, 200);
  const { stats, snapshot } = res.json();
  assert.equal(stats.registered, 6);
  assert.equal(stats.checkedIn, 2);
  assert.equal(stats.lunchClaimed, 1);
  assert.equal(stats.yetToCheckIn, 4);
  assert.equal(snapshot.version, '2026-08-15');
});

test('GET /api/admin/checkins returns the log newest first', async () => {
  const fake = setup({
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ['2026-08-20T09:00:00+05:30', 'john@example.com', 'John Doe', '', '', '', '', 'Checked In'],
      ['2026-08-20T11:00:00+05:30', 'priya@example.com', 'Priya Sharma', '', '', '', '', 'Checked In'],
    ],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });

  const res = await call(checkinsRoute, {
    method: 'GET',
    url: '/api/admin/checkins',
    headers: authCookie(),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().total, 2);
  assert.equal(res.json().checkIns[0].email, 'priya@example.com');
  assert.equal(fake.calls.get > 0, true);
});

/* ==========================================================================
 * GET /api/admin/teams
 * ========================================================================== */

async function teamsFor(emails, teams) {
  setup({
    CheckIn: [
      EMPTY_SHEETS.CheckIn[0],
      ...emails.map((email) => [
        '2026-08-20T09:00:00+05:30',
        email,
        'Name',
        '',
        '',
        '',
        '',
        'Checked In',
      ]),
    ],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });

  return call(teamsRoute, {
    method: 'GET',
    url: `/api/admin/teams?teams=${teams}`,
    headers: authCookie(),
  });
}

const ALL_SIX = [
  'john@example.com',
  'priya@example.com',
  'alex@example.com',
  'sam@example.com',
  'riya@example.com',
  'dana@example.com',
];

test('teams: everyone checked in appears exactly once', async () => {
  const res = await teamsFor(ALL_SIX, 3);
  const { teams, totalAttendees } = res.json();

  const members = teams.flat().map((m) => m.email);
  assert.equal(totalAttendees, 6);
  assert.equal(members.length, 6);
  assert.equal(new Set(members).size, 6);
  assert.deepEqual([...members].sort(), [...ALL_SIX].sort());
});

test('teams: an even split is even', async () => {
  const res = await teamsFor(ALL_SIX, 3);
  assert.deepEqual(
    res.json().teams.map((t) => t.length),
    [2, 2, 2]
  );
});

test('teams: an uneven split differs by at most one', async () => {
  const res = await teamsFor(ALL_SIX.slice(0, 5), 3);
  const sizes = res.json().teams.map((t) => t.length).sort((a, b) => b - a);

  assert.deepEqual(sizes, [2, 2, 1]);
  assert.ok(sizes[0] - sizes[sizes.length - 1] <= 1);
});

test('teams: fewer attendees than teams yields one team each, not empty teams', async () => {
  const res = await teamsFor(ALL_SIX.slice(0, 2), 5);
  const { teams, teamCount } = res.json();

  assert.equal(teamCount, 2);
  assert.equal(teams.length, 2);
  assert.ok(teams.every((t) => t.length === 1));
});

test('teams: one attendee', async () => {
  const res = await teamsFor([ALL_SIX[0]], 3);
  assert.equal(res.json().teamCount, 1);
  assert.equal(res.json().teams[0].length, 1);
});

test('teams: as many teams as attendees', async () => {
  const res = await teamsFor(ALL_SIX.slice(0, 4), 4);
  assert.equal(res.json().teamCount, 4);
  assert.ok(res.json().teams.every((t) => t.length === 1));
});

test('teams: zero attendees is an empty result, not an error', async () => {
  const res = await teamsFor([], 5);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().teams, []);
  assert.equal(res.json().totalAttendees, 0);
});

test('teams: duplicate check-in rows cannot put one person on two teams', async () => {
  const res = await teamsFor(
    ['john@example.com', 'JOHN@EXAMPLE.COM', 'john@example.com', 'priya@example.com'],
    2
  );

  const members = res.json().teams.flat().map((m) => m.email);
  assert.equal(members.length, 2);
  assert.equal(new Set(members).size, 2);
});

test('teams: randomizing again reshuffles', async () => {
  // With 8 attendees over 4 teams, an unchanged arrangement across ten draws
  // would mean the shuffle is not running at all.
  const emails = ALL_SIX.concat(['x1@example.com', 'x2@example.com']);
  const first = JSON.stringify((await teamsFor(emails, 4)).json().teams);

  let changed = false;
  for (let i = 0; i < 10 && !changed; i++) {
    if (JSON.stringify((await teamsFor(emails, 4)).json().teams) !== first) changed = true;
  }
  assert.ok(changed, 'ten draws produced an identical arrangement');
});

test('teams: an invalid count is refused', async () => {
  setup();

  for (const value of ['0', '-1', 'abc', '', '1.5.2', '101', '999999']) {
    const res = await call(teamsRoute, {
      method: 'GET',
      url: `/api/admin/teams?teams=${value}`,
      headers: authCookie(),
    });
    assert.equal(res.statusCode, 400, `for teams=${value}`);
    assert.equal(res.json().status, 'INVALID_REQUEST');
  }
});

test('teams: a missing count is refused', async () => {
  setup();
  const res = await call(teamsRoute, {
    method: 'GET',
    url: '/api/admin/teams',
    headers: authCookie(),
  });

  assert.equal(res.statusCode, 400);
});
