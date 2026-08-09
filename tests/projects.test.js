/**
 * The ProjectUploads tab: read side only.
 *
 * The submission form does not exist yet, so these tests cover what the admin
 * dashboard needs — reading the tab, surviving its absence, and never handing
 * the browser a link it should not follow.
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

const projectsRoute = (await import('../api/admin/projects.js')).default;
const { getProjectUploads, __resetProjectsCache, PROJECT_HEADERS } = await import(
  '../api/_lib/projects.js'
);
const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets } = await import('./helpers/fakeSheets.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');

const TAB = 'ProjectUploads';

const authCookie = () => ({
  cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}`,
});

function setup(initial = {}) {
  __resetProjectsCache();
  __resetRateLimits();
  return createFakeSheets(initial);
}

const row = (timestamp, team, link, status = 'Submitted') => [timestamp, team, link, status];

const SEEDED = {
  [TAB]: [
    PROJECT_HEADERS,
    row('2026-08-20T10:42:00+05:30', 'Tableau Visionaries', 'https://drive.google.com/file/d/aaa'),
    row('2026-08-20T10:51:00+05:30', 'Agentic Minds', 'https://drive.google.com/file/d/bbb'),
    row('2026-08-20T11:03:00+05:30', 'Data Architects', 'https://drive.google.com/file/d/ccc'),
  ],
};

test('reads submissions from the tab', async () => {
  const fake = setup(SEEDED);
  const { submissions } = await getProjectUploads({ sheets: fake.sheets });

  assert.equal(submissions.length, 3);
  const names = submissions.map((s) => s.teamName).sort();
  assert.deepEqual(names, ['Agentic Minds', 'Data Architects', 'Tableau Visionaries']);
});

test('exposes team name, link, time and status', async () => {
  const fake = setup(SEEDED);
  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  const entry = submissions.find((s) => s.teamName === 'Tableau Visionaries');

  assert.equal(entry.driveLink, 'https://drive.google.com/file/d/aaa');
  assert.equal(entry.submittedAt, '2026-08-20T10:42:00+05:30');
  assert.equal(entry.status, 'Submitted');
});

test('newest submission comes first', async () => {
  const fake = setup(SEEDED);
  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  assert.equal(submissions[0].teamName, 'Data Architects');
});

test('an empty tab reads as no submissions and gets its headers written', async () => {
  const fake = setup({ [TAB]: [] });
  const { submissions } = await getProjectUploads({ sheets: fake.sheets });

  assert.deepEqual(submissions, []);
  assert.deepEqual(fake.rows(TAB)[0], PROJECT_HEADERS);
});

test('a missing tab is created rather than failing the dashboard', async () => {
  const fake = setup({});
  fake.markMissing(TAB);

  const { submissions } = await getProjectUploads({ sheets: fake.sheets });

  assert.deepEqual(submissions, [], 'no submissions is the honest answer');
  assert.equal(fake.calls.ensure, 1, 'the tab was created');
  assert.ok(fake.exists(TAB));
  assert.deepEqual(fake.rows(TAB)[0], PROJECT_HEADERS);
});

test('creating the tab does not touch CheckIn, Lunch or Registrations', async () => {
  const fake = setup({
    CheckIn: [['Timestamp', 'Email']],
    Lunch: [['Timestamp', 'Email']],
    Registrations: [['Timestamp', 'Email']],
  });
  fake.markMissing(TAB);

  const before = {
    CheckIn: JSON.stringify(fake.rows('CheckIn')),
    Lunch: JSON.stringify(fake.rows('Lunch')),
    Registrations: JSON.stringify(fake.rows('Registrations')),
  };

  await getProjectUploads({ sheets: fake.sheets });

  for (const tab of Object.keys(before)) {
    assert.equal(JSON.stringify(fake.rows(tab)), before[tab], `${tab} was modified`);
  }
});

test('column order and spelling do not matter', async () => {
  const fake = setup({
    [TAB]: [
      ['Submission Status', 'Drive Link', 'Team', 'Timestamp'],
      ['Reviewed', 'https://drive.google.com/x', 'Viz Innovators', '2026-08-20T12:00:00+05:30'],
    ],
  });

  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  assert.equal(submissions[0].teamName, 'Viz Innovators');
  assert.equal(submissions[0].driveLink, 'https://drive.google.com/x');
  assert.equal(submissions[0].status, 'Reviewed');
});

test('a row with neither team nor link is skipped', async () => {
  const fake = setup({
    [TAB]: [PROJECT_HEADERS, row('2026-08-20T10:00:00+05:30', '', ''), []],
  });

  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  assert.deepEqual(submissions, []);
});

test('a row with no status still reports as Submitted', async () => {
  const fake = setup({
    [TAB]: [PROJECT_HEADERS, ['2026-08-20T10:00:00+05:30', 'Insight Labs', 'https://drive.google.com/y', '']],
  });

  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  assert.equal(submissions[0].status, 'Submitted');
});

test('a dangerous link is refused rather than handed to the browser', async () => {
  const fake = setup({
    [TAB]: [
      PROJECT_HEADERS,
      row('2026-08-20T10:00:00+05:30', 'Bad Actor', 'javascript:alert(document.cookie)'),
      row('2026-08-20T10:01:00+05:30', 'Odd Data', 'data:text/html,<script>x</script>'),
      row('2026-08-20T10:02:00+05:30', 'Not A Url', 'see the shared folder'),
      row('2026-08-20T10:03:00+05:30', 'Fine', 'https://drive.google.com/ok'),
    ],
  });

  const { submissions } = await getProjectUploads({ sheets: fake.sheets });
  const byTeam = Object.fromEntries(submissions.map((s) => [s.teamName, s.driveLink]));

  // The row still shows — the team submitted something — but with no link.
  assert.equal(byTeam['Bad Actor'], '');
  assert.equal(byTeam['Odd Data'], '');
  assert.equal(byTeam['Not A Url'], '');
  assert.equal(byTeam.Fine, 'https://drive.google.com/ok');
});

/* ==========================================================================
 * ROUTE
 * ========================================================================== */

test('GET /api/admin/projects returns submissions to a signed-in organizer', async () => {
  const fake = setup(SEEDED);
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectsRoute, {
      method: 'GET',
      url: '/api/admin/projects',
      headers: authCookie(),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total, 3);
    assert.equal(res.json().submissions[0].teamName, 'Data Architects');
  } finally {
    restore();
  }
});

test('GET /api/admin/projects refuses an anonymous caller', async () => {
  const fake = setup(SEEDED);
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectsRoute, { method: 'GET', url: '/api/admin/projects' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.includes('drive.google.com'), false, 'leaked a link to an anonymous caller');
  } finally {
    restore();
  }
});

test('/api/admin/projects allows only GET', async () => {
  const fake = setup(SEEDED);
  const restore = installFakeSheets(fake);

  try {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await call(projectsRoute, {
        method,
        url: '/api/admin/projects',
        headers: authCookie(),
      });
      assert.equal(res.statusCode, 405, `for ${method}`);
    }
  } finally {
    restore();
  }
});

test('repeated reads within the cache window cost one sheet read', async () => {
  const fake = setup(SEEDED);

  await getProjectUploads({ sheets: fake.sheets });
  await getProjectUploads({ sheets: fake.sheets });
  await getProjectUploads({ sheets: fake.sheets });

  // Auto-refresh must not multiply Google reads by the number of open dashboards.
  assert.equal(fake.calls.get, 1);
});

test('new submissions appear once the cache window passes', async () => {
  const fake = setup(SEEDED);
  assert.equal((await getProjectUploads({ sheets: fake.sheets })).submissions.length, 3);

  await fake.sheets.appendSheetRow(
    TAB,
    row('2026-08-20T11:30:00+05:30', 'Late Team', 'https://drive.google.com/late')
  );

  __resetProjectsCache(); // stands in for the TTL elapsing
  const { submissions } = await getProjectUploads({ sheets: fake.sheets });

  assert.equal(submissions.length, 4);
  assert.equal(submissions[0].teamName, 'Late Team', 'newest first');
});
