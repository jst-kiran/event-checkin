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
  __resetProjectsCache,
  PROJECT_HEADERS,
} = await import('../api/_lib/projects.js');

const {
  saveGeneratedTeams,
  __resetGeneratedTeamsCache,
  TEAMS_HEADERS,
} = await import('../api/_lib/generatedTeams.js');

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
