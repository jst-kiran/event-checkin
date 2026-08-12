/**
 * The team randomizer, end to end through the real route.
 *
 * The organizer supplies members-per-team; the number of teams is arithmetic
 * the system does. The ignore list is temporary by construction — these tests
 * assert that too, because "no persistent organizer role" is a requirement, not
 * an implementation detail.
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

const teamsRoute = (await import('../api/admin/teams.js')).default;
const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets, EMPTY_SHEETS } = await import('./helpers/fakeSheets.js');
const { __resetReadCache } = await import('../api/_lib/attendance.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');
const { TEAM_NAMES } = await import('../api/_lib/teamNames.js');

let restoreSheets = () => {};

const authCookie = () => ({
  cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}`,
});

function checkInRow(email, name) {
  return ['2026-08-20T09:00:00+05:30', email, name, 'Acme', '', '', '', 'Checked In'];
}

/** Builds a roster of `count` synthetic checked-in attendees. */
function roster(count) {
  return Array.from({ length: count }, (_, i) =>
    checkInRow(`person${i + 1}@example.com`, `Person ${i + 1}`)
  );
}

async function draw(rows, { size, ignore } = {}) {
  restoreSheets();
  __resetReadCache();
  __resetRateLimits();

  const fake = createFakeSheets({
    CheckIn: [EMPTY_SHEETS.CheckIn[0], ...rows],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });
  restoreSheets = installFakeSheets(fake);

  const params = new URLSearchParams();
  if (size !== undefined) params.set('size', String(size));
  if (ignore !== undefined) params.set('ignore', ignore);

  return call(teamsRoute, {
    method: 'GET',
    url: `/api/admin/teams?${params}`,
    headers: authCookie(),
  });
}

const everyone = (payload) => payload.teams.flatMap((team) => team.members.map((m) => m.email));

/* ==========================================================================
 * TEAM SIZE AND COUNT
 * ========================================================================== */

test('43 people at 5 per team becomes 9 teams of 5,5,5,5,5,5,5,4,4', async () => {
  const res = await draw(roster(43), { size: 5 });
  const payload = res.json();

  assert.equal(res.statusCode, 200);
  assert.equal(payload.teamCount, 9);

  const sizes = payload.teams.map((team) => team.members.length).sort((a, b) => b - a);
  assert.deepEqual(sizes, [5, 5, 5, 5, 5, 5, 5, 4, 4]);
});

test('the admin never has to calculate the team count', async () => {
  for (const [people, size, expected] of [
    [10, 5, 2],
    [11, 5, 3],
    [20, 4, 5],
    [7, 3, 3],
    [1, 5, 1],
    [58, 6, 10],
  ]) {
    const payload = (await draw(roster(people), { size })).json();
    assert.equal(payload.teamCount, expected, `${people} people at ${size} per team`);
  }
});

test('every eligible attendee appears exactly once', async () => {
  const payload = (await draw(roster(43), { size: 5 })).json();
  const emails = everyone(payload);

  assert.equal(emails.length, 43, 'nobody omitted');
  assert.equal(new Set(emails).size, 43, 'nobody duplicated');
});

test('team sizes never differ by more than one', async () => {
  for (const [people, size] of [
    [43, 5],
    [17, 4],
    [23, 7],
    [100, 9],
  ]) {
    const payload = (await draw(roster(people), { size })).json();
    const sizes = payload.teams.map((team) => team.members.length);
    assert.ok(
      Math.max(...sizes) - Math.min(...sizes) <= 1,
      `${people}/${size} produced sizes ${sizes.join(',')}`
    );
  }
});

test('no team is ever empty', async () => {
  for (const [people, size] of [
    [3, 5],
    [1, 100],
    [9, 2],
    [43, 5],
  ]) {
    const payload = (await draw(roster(people), { size })).json();
    assert.ok(
      payload.teams.every((team) => team.members.length > 0),
      `${people}/${size} produced an empty team`
    );
  }
});

test('fewer participants than the requested size still yields one team', async () => {
  const payload = (await draw(roster(3), { size: 5 })).json();
  assert.equal(payload.teamCount, 1);
  assert.equal(payload.teams[0].members.length, 3);
});

test('zero checked-in attendees is an empty result, not an error', async () => {
  const res = await draw([], { size: 5 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().teams, []);
  assert.equal(res.json().totalAttendees, 0);
});

test('the draw is reshuffled each time', async () => {
  const rows = roster(20);
  const first = JSON.stringify((await draw(rows, { size: 4 })).json().teams);

  let changed = false;
  for (let i = 0; i < 10 && !changed; i++) {
    if (JSON.stringify((await draw(rows, { size: 4 })).json().teams) !== first) changed = true;
  }
  assert.ok(changed, 'ten draws produced an identical arrangement');
});

test('duplicate check-in rows cannot put one person on two teams', async () => {
  const rows = [
    checkInRow('john@example.com', 'John Doe'),
    checkInRow('JOHN@EXAMPLE.COM', 'John Doe'),
    checkInRow('priya@example.com', 'Priya Sharma'),
  ];

  const emails = everyone((await draw(rows, { size: 1 })).json());
  assert.equal(emails.length, 2);
  assert.equal(new Set(emails).size, 2);
});

test('an invalid size is refused', async () => {
  for (const size of ['0', '-1', 'abc', '', '1.5.2', '101', '999999']) {
    const res = await draw(roster(10), { size });
    assert.equal(res.statusCode, 400, `for size=${size}`);
    assert.equal(res.json().status, 'INVALID_REQUEST');
  }
});

test('a missing size loads stored generated teams', async () => {
  const res = await draw(roster(10), {});
  assert.equal(res.statusCode, 200);
});

/* ==========================================================================
 * TEAM NAMES
 * ========================================================================== */

test('teams get event-themed names, never "Team 1"', async () => {
  const payload = (await draw(roster(20), { size: 4 })).json();

  for (const team of payload.teams) {
    assert.ok(team.name, 'every team is named');
    assert.doesNotMatch(team.name, /^Team \d+$/, `generic name: ${team.name}`);
    assert.ok(
      TEAM_NAMES.some((name) => team.name.startsWith(name)),
      `${team.name} is not from the curated list`
    );
  }
});

test('team names are unique within a draw', async () => {
  const payload = (await draw(roster(60), { size: 2 })).json();
  const names = payload.teams.map((team) => team.name);

  assert.equal(payload.teamCount, 30);
  assert.equal(new Set(names).size, names.length);
});

test('more teams than curated names still produces unique names', async () => {
  // One person per team forces more teams than the name list holds.
  const people = TEAM_NAMES.length + 12;
  const payload = (await draw(roster(people), { size: 1 })).json();
  const names = payload.teams.map((team) => team.name);

  assert.equal(names.length, people);
  assert.equal(new Set(names).size, names.length, 'names collided past the end of the list');
});

/* ==========================================================================
 * TEMPORARY IGNORE LIST
 * ========================================================================== */

const NAMED = [
  checkInRow('rahul@example.com', 'Rahul Patel'),
  checkInRow('priya@example.com', 'Priya Sharma'),
  checkInRow('alex@example.com', 'Alex Chen'),
  checkInRow('sam@example.com', 'Sam Patel'),
  checkInRow('dana@example.com', 'Dana Cruz'),
  checkInRow('riya@example.com', 'Riya Nair'),
];

test('ignored members never appear in any team', async () => {
  const payload = (await draw(NAMED, { size: 2, ignore: 'Rahul Patel, Priya Sharma' })).json();
  const emails = everyone(payload);

  assert.equal(emails.includes('rahul@example.com'), false);
  assert.equal(emails.includes('priya@example.com'), false);
  assert.equal(emails.length, 4);
  assert.equal(payload.totalAttendees, 4);
  assert.equal(payload.ignoredCount, 2);
  assert.equal(payload.checkedInCount, 6, 'the roster itself is unchanged');
});

test('ignored names tolerate capitalization and stray spaces', async () => {
  for (const typed of ['rahul patel', 'RAHUL PATEL', '  Rahul   Patel  ', 'RaHuL pAtEl']) {
    const payload = (await draw(NAMED, { size: 2, ignore: typed })).json();
    assert.equal(
      everyone(payload).includes('rahul@example.com'),
      false,
      `failed for ${JSON.stringify(typed)}`
    );
  }
});

test('an unmatched name blocks the draw and is reported', async () => {
  const res = await draw(NAMED, { size: 2, ignore: 'Rahul Patel, Nobody Here' });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json().unmatched, ['Nobody Here']);
  // The typo must not silently produce a draw.
  assert.equal(res.json().teams, undefined);
});

test('an ambiguous name blocks the draw and shows who it could be', async () => {
  const twins = [
    checkInRow('patel1@example.com', 'Sam Patel'),
    checkInRow('patel2@example.com', 'Sam Patel'),
    checkInRow('alex@example.com', 'Alex Chen'),
  ];

  const res = await draw(twins, { size: 2, ignore: 'Sam Patel' });
  const payload = res.json();

  assert.equal(res.statusCode, 400);
  assert.equal(payload.ambiguous.length, 1);
  assert.equal(payload.ambiguous[0].candidates.length, 2);

  // Enough detail for the organizer to resolve it themselves.
  const emails = payload.ambiguous[0].candidates.map((c) => c.email).sort();
  assert.deepEqual(emails, ['patel1@example.com', 'patel2@example.com']);
  assert.ok(payload.ambiguous[0].candidates.every((c) => 'organization' in c));
  assert.equal(payload.teams, undefined, 'must not guess which person was meant');
});

test('an empty or omitted ignore list includes everyone', async () => {
  for (const ignore of [undefined, '', '   ', ',,,']) {
    const payload = (await draw(NAMED, { size: 3, ignore })).json();
    assert.equal(payload.totalAttendees, 6, `failed for ${JSON.stringify(ignore)}`);
    assert.equal(payload.ignoredCount, 0);
  }
});

test('the ignore list applies only to the draw that used it', async () => {
  const excluded = (await draw(NAMED, { size: 2, ignore: 'Rahul Patel' })).json();
  assert.equal(excluded.totalAttendees, 5);

  // A fresh draw with no ignore list must see the full roster again — nothing
  // about Rahul was persisted anywhere.
  const next = (await draw(NAMED, { size: 2 })).json();
  assert.equal(next.totalAttendees, 6);
  assert.equal(everyone(next).includes('rahul@example.com'), true);
});

test('randomize GET produces preview without writing to Google Sheets', async () => {
  restoreSheets();
  __resetReadCache();
  __resetRateLimits();

  const fake = createFakeSheets({
    CheckIn: [EMPTY_SHEETS.CheckIn[0], ...NAMED],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });
  restoreSheets = installFakeSheets(fake);

  const before = JSON.stringify(fake.rows('CheckIn'));
  const res = await call(teamsRoute, {
    method: 'GET',
    url: '/api/admin/teams?size=2&ignore=Rahul%20Patel',
    headers: authCookie(),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().isPreview, true);
  assert.equal(JSON.stringify(fake.rows('CheckIn')), before, 'CheckIn was modified');
  assert.equal(fake.calls.append, 0);
  assert.equal(fake.rows('Teams').length, 0, 'Teams tab was not modified during preview');
});

test('ignoring everyone yields an empty draw rather than an error', async () => {
  const res = await draw(NAMED, {
    size: 2,
    ignore: 'Rahul Patel,Priya Sharma,Alex Chen,Sam Patel,Dana Cruz,Riya Nair',
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().teams, []);
  assert.equal(res.json().totalAttendees, 0);
  assert.equal(res.json().checkedInCount, 6);
});

test('the same name listed twice is only excluded once', async () => {
  const payload = (await draw(NAMED, { size: 2, ignore: 'Rahul Patel, rahul patel' })).json();
  assert.equal(payload.ignoredCount, 1);
  assert.equal(payload.totalAttendees, 5);
});

test('POST save teams persists complete team/member data and restores after cold start', async () => {
  restoreSheets();
  __resetReadCache();
  __resetRateLimits();

  const fake = createFakeSheets({
    CheckIn: [EMPTY_SHEETS.CheckIn[0], ...NAMED],
    Lunch: [EMPTY_SHEETS.Lunch[0]],
  });
  restoreSheets = installFakeSheets(fake);

  // 1. Generate preview teams with size 3 (unsaved)
  const genRes = await call(teamsRoute, {
    method: 'GET',
    url: '/api/admin/teams?size=3',
    headers: authCookie(),
  });
  assert.equal(genRes.statusCode, 200);
  const preview = genRes.json();
  assert.equal(preview.isPreview, true);
  assert.equal(fake.rows('Teams').length, 0, 'Teams not saved yet');

  // 2. Explicit POST to save teams
  const saveRes = await call(teamsRoute, {
    method: 'POST',
    url: '/api/admin/teams',
    headers: authCookie(),
    body: preview,
  });
  assert.equal(saveRes.statusCode, 200);
  assert.equal(saveRes.json().isSaved, true);
  assert.ok(fake.rows('Teams').length > 1, 'Teams saved to sheet');

  // 3. Simulate cold start by resetting cache and calling GET /api/admin/teams without size
  const { __resetGeneratedTeamsCache } = await import('../api/_lib/generatedTeams.js');
  __resetGeneratedTeamsCache();

  const loadRes = await call(teamsRoute, {
    method: 'GET',
    url: '/api/admin/teams',
    headers: authCookie(),
  });

  assert.equal(loadRes.statusCode, 200);
  const loaded = loadRes.json();
  assert.equal(loaded.isSaved, true);
  assert.equal(loaded.totalAttendees, 6);
  assert.equal(loaded.teams.length, 2);

  // Verify member details exist in restored structure
  const firstMember = loaded.teams[0].members[0];
  assert.ok(firstMember.name, 'Member has name');
  assert.ok(firstMember.email, 'Member has email');
});
