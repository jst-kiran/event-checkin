/**
 * Tests for public attendee-facing Project Upload functionality.
 *
 * Covers:
 * - Single source of truth validation against generated teams in Google Sheets
 * - submitProjectUpload helper in api/_lib/projects.js
 * - POST /api/project-upload handler in api/project-upload.js
 * - Validation of Team Name (dropdown / canonical match) and Google Drive Link
 * - Preserving existing sheet structure requirement (erroring if tab/headers missing)
 * - Cache invalidation making new submissions immediately readable by admin endpoint
 * - Re-generation invalidating previous teams
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');
process.env.SESSION_SECRET = 'test-session-secret-value-long-enough';

const projectUploadRoute = (await import('../api/project-upload.js')).default;
const publicTeamsRoute = (await import('../api/teams.js')).default;
const projectsAdminRoute = (await import('../api/admin/projects.js')).default;
const adminTeamsRoute = (await import('../api/admin/teams.js')).default;

const {
  submitProjectUpload,
  getProjectUploads,
  getSubmittedTeamNames,
  __resetProjectsCache,
  PROJECT_HEADERS,
  DUPLICATE_STATUS,
} = await import('../api/_lib/projects.js');

const {
  saveGeneratedTeams,
  __resetGeneratedTeamsCache,
  TEAMS_HEADERS,
} = await import('../api/_lib/generatedTeams.js');

const {
  setProjectSubmissionDeadline,
  __resetSettingsCache,
} = await import('../api/_lib/settings.js');

const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets } = await import('./helpers/fakeSheets.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');

const TAB = 'ProjectUploads';
const TEAMS_TAB = 'Teams';

const authCookie = () => ({
  cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}`,
});

function setup(initial = {}) {
  __resetProjectsCache();
  __resetGeneratedTeamsCache();
  __resetSettingsCache();
  __resetRateLimits();
  return createFakeSheets({
    [TAB]: [PROJECT_HEADERS],
    [TEAMS_TAB]: [TEAMS_HEADERS],
    ...initial,
  });
}

async function seedActiveTeams(fake, teamNames = ['Tableau Visionaries', 'Agentic Explorers']) {
  const teams = teamNames.map((name) => ({
    name,
    members: [{ name: 'Member One', email: 'one@example.com', organization: 'Org A' }],
  }));

  await saveGeneratedTeams({
    teams,
    teamCount: teams.length,
    teamSize: 5,
    totalAttendees: teams.length,
    checkedInCount: teams.length,
    ignoredCount: 0,
    ignored: [],
    sheets: fake.sheets,
  });
}

/* ==========================================================================
 * UNIT TESTS: submitProjectUpload
 * ========================================================================== */

test('submitProjectUpload rejects if no teams have been generated yet', async () => {
  const fake = setup();
  const result = await submitProjectUpload({
    teamName: 'Tableau Visionaries',
    driveLink: 'https://drive.google.com/file/d/sample123',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'TEAMS_NOT_GENERATED');
});

test('submitProjectUpload appends row when generated team matches canonical name', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Tableau Visionaries', 'Agentic Explorers']);

  const result = await submitProjectUpload({
    teamName: '   tableau visionaries   ',
    driveLink: 'https://drive.google.com/file/d/sample123',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'PROJECT_SUBMITTED');
  assert.equal(result.submission.teamName, 'Tableau Visionaries', 'uses canonical casing');
  assert.equal(result.submission.driveLink, 'https://drive.google.com/file/d/sample123');

  const rows = fake.rows(TAB);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'Tableau Visionaries');
});

test('submitProjectUpload fails with INVALID_TEAM_NAME if teamName is not in active generated teams', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Tableau Visionaries']);

  const result = await submitProjectUpload({
    teamName: 'IBM Winners',
    driveLink: 'https://drive.google.com/file/d/sample123',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'INVALID_TEAM_NAME');
  assert.equal(fake.rows(TAB).length, 1, 'did not write any row to Google Sheets');
});

test('submitProjectUpload fails with INVALID_DRIVE_LINK if driveLink is invalid URL', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Tableau Visionaries']);

  const result = await submitProjectUpload({
    teamName: 'Tableau Visionaries',
    driveLink: 'not-a-valid-url',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'INVALID_DRIVE_LINK');
});

/* ==========================================================================
 * UNIT TESTS: one submission per team
 * ========================================================================== */

test('a second submission for the same team is refused without writing a row', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Repeat Offenders']);

  const first = await submitProjectUpload({
    teamName: 'Repeat Offenders',
    driveLink: 'https://drive.google.com/first',
    sheets: fake.sheets,
  });
  assert.equal(first.status, 'PROJECT_SUBMITTED');

  const second = await submitProjectUpload({
    teamName: 'repeat offenders', // different casing, same team
    driveLink: 'https://drive.google.com/second',
    sheets: fake.sheets,
  });
  assert.equal(second.status, 'TEAM_ALREADY_SUBMITTED');

  // The in-process lock catches this before ever appending a second row.
  assert.equal(fake.rows(TAB).length, 2, 'header plus exactly one submission');
});

test('getSubmittedTeamNames excludes a team once it has submitted', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Submitted Team', 'Pending Team']);
  await submitProjectUpload({
    teamName: 'Submitted Team',
    driveLink: 'https://drive.google.com/x',
    sheets: fake.sheets,
  });

  const names = await getSubmittedTeamNames({ sheets: fake.sheets });
  assert.deepEqual(names, ['Submitted Team']);
});

test('a row appended by another instance mid-request loses to the earlier row', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Viz Innovators']);

  // Simulates a second lambda instance: it appends between our read and our
  // append, so its row lands first and ours is the duplicate.
  fake.beforeNextAppend(async (sheets) => {
    await sheets.appendSheetRow(TAB, [
      '2026-08-20T10:00:00+05:30',
      'Viz Innovators',
      'https://drive.google.com/rival',
      'Submitted',
    ]);
  });

  const result = await submitProjectUpload({
    teamName: 'Viz Innovators',
    driveLink: 'https://drive.google.com/mine',
    sheets: fake.sheets,
  });

  // The attendee is told the truth, and the sheet ends up with one live row.
  assert.equal(result.status, 'TEAM_ALREADY_SUBMITTED');

  const rows = fake.rows(TAB).slice(1);
  assert.equal(rows.length, 2, 'the losing row is marked, never deleted');
  assert.equal(rows[0][2], 'https://drive.google.com/rival', 'the earlier row wins');
  assert.equal(rows[1][3], DUPLICATE_STATUS, 'the later row is marked, not deleted');
});

/* ==========================================================================
 * UNIT TESTS: admin-set deadline
 * ========================================================================== */

test('submitProjectUpload refuses once the deadline has passed', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Deadline Team']);
  await setProjectSubmissionDeadline('2026-08-10T10:00', { sheets: fake.sheets });

  const result = await submitProjectUpload({
    teamName: 'Deadline Team',
    driveLink: 'https://drive.google.com/x',
    sheets: fake.sheets,
    now: new Date('2026-08-15T00:00:00+05:30'),
  });

  assert.equal(result.status, 'SUBMISSIONS_CLOSED');
  assert.equal(fake.rows(TAB).length, 1, 'nothing was written once closed');
});

test('submitProjectUpload still accepts submissions before the deadline', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['On Time Team']);
  await setProjectSubmissionDeadline('2026-08-20T23:59', { sheets: fake.sheets });

  const result = await submitProjectUpload({
    teamName: 'On Time Team',
    driveLink: 'https://drive.google.com/x',
    sheets: fake.sheets,
    now: new Date('2026-08-15T00:00:00+05:30'),
  });

  assert.equal(result.status, 'PROJECT_SUBMITTED');
});

test('an unset deadline never closes submissions', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['No Deadline Team']);

  const result = await submitProjectUpload({
    teamName: 'No Deadline Team',
    driveLink: 'https://drive.google.com/x',
    sheets: fake.sheets,
  });

  assert.equal(result.status, 'PROJECT_SUBMITTED');
});

/* ==========================================================================
 * ROUTE TESTS: POST /api/project-upload & GET /api/teams
 * ========================================================================== */

test('GET /api/teams returns hasTeams: false when no teams generated', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const res = await call(publicTeamsRoute, { method: 'GET', url: '/api/teams' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().hasTeams, false);
    assert.deepEqual(res.json().teams, []);
  } finally {
    restore();
  }
});

test('GET /api/teams returns active team names after generation', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Tableau Visionaries', 'Agentic Explorers']);
  const restore = installFakeSheets(fake);

  try {
    const res = await call(publicTeamsRoute, { method: 'GET', url: '/api/teams' });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.hasTeams, true);
    assert.deepEqual(data.teamNames, ['Tableau Visionaries', 'Agentic Explorers']);
    assert.equal(data.teams.length, 2);
    assert.equal(data.teams[0].name, 'Tableau Visionaries');
  } finally {
    restore();
  }
});

test('POST /api/project-upload accepts valid submission for generated team', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Viz Innovators']);
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: {
        teamName: 'viz innovators',
        driveLink: 'https://drive.google.com/drive/folders/testfolder',
      },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'PROJECT_SUBMITTED');
    assert.equal(data.submission.teamName, 'Viz Innovators');
  } finally {
    restore();
  }
});

test('Re-generation invalidates old teams and accepts new teams', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Team A', 'Team B']);
  const restore = installFakeSheets(fake);

  try {
    // Old team submission succeeds
    const res1 = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Team A', driveLink: 'https://drive.google.com/a' },
    });
    assert.equal(res1.statusCode, 200);

    // Re-generate teams -> replace active teams with Team C and Team D
    await seedActiveTeams(fake, ['Team C', 'Team D']);

    // Attempting to submit for old Team A now fails
    const res2 = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Team A', driveLink: 'https://drive.google.com/a2' },
    });
    assert.equal(res2.statusCode, 400);
    assert.equal(res2.json().status, 'INVALID_TEAM_NAME');

    // Submitting for new Team C succeeds
    const res3 = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Team C', driveLink: 'https://drive.google.com/c' },
    });
    assert.equal(res3.statusCode, 200);
  } finally {
    restore();
  }
});

test('GET /api/teams excludes a team that has already submitted', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Submitted Team', 'Pending Team']);
  await submitProjectUpload({
    teamName: 'Submitted Team',
    driveLink: 'https://drive.google.com/x',
    sheets: fake.sheets,
  });

  const restore = installFakeSheets(fake);
  try {
    const res = await call(publicTeamsRoute, { method: 'GET', url: '/api/teams' });
    const data = res.json();
    assert.deepEqual(data.teamNames.slice().sort(), ['Pending Team', 'Submitted Team']);
    assert.deepEqual(data.availableTeamNames, ['Pending Team']);
  } finally {
    restore();
  }
});

test('POST /api/project-upload refuses a second submission with 409', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Repeat Team']);
  const restore = installFakeSheets(fake);

  try {
    const first = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Repeat Team', driveLink: 'https://drive.google.com/first' },
    });
    assert.equal(first.statusCode, 200);

    const second = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Repeat Team', driveLink: 'https://drive.google.com/second' },
    });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().status, 'TEAM_ALREADY_SUBMITTED');
  } finally {
    restore();
  }
});

test('GET /api/teams reports submissionsClosed once the deadline has passed', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Team X']);
  await setProjectSubmissionDeadline('2020-01-01T00:00', { sheets: fake.sheets });
  const restore = installFakeSheets(fake);

  try {
    const res = await call(publicTeamsRoute, { method: 'GET', url: '/api/teams' });
    const data = res.json();
    assert.equal(data.submissionsClosed, true);
    assert.ok(data.submissionDeadline);
  } finally {
    restore();
  }
});

test('POST /api/project-upload refuses once the deadline has passed, with 400', async () => {
  const fake = setup();
  await seedActiveTeams(fake, ['Late Team']);
  await setProjectSubmissionDeadline('2020-01-01T00:00', { sheets: fake.sheets });
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectUploadRoute, {
      method: 'POST',
      url: '/api/project-upload',
      body: { teamName: 'Late Team', driveLink: 'https://drive.google.com/late' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().status, 'SUBMISSIONS_CLOSED');
  } finally {
    restore();
  }
});
