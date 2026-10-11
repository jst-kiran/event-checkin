/**
 * The previous event's endpoints (lunch, project upload, teams, stats, the old
 * check-in log …) are off on the server, not just hidden in the UI. Their
 * route files no longer exist, so:
 *
 *   - on Vercel there is no function behind /api/checkin, /api/lunch, … and
 *     the platform answers 404 (the SPA rewrite in vercel.json excludes /api);
 *   - in local development the Vite /api plugin answers 404 the same way.
 *
 * Either way, nothing runs and no data is read or written.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devApiPlugin from '../dev/vite-api-plugin.js';
import { createRequest, createResponse, installFakeSheets } from './helpers/http.js';
import { createFakeSheets } from './helpers/fakeSheets.js';
import { REGISTRATION_ROWS, TEST_SHEET_ID, TEST_TAB } from './fixtures/registration-sheet.js';
import { __resetRegistrationCache } from '../api/_lib/registrations.js';
import { __resetRateLimits } from '../api/_lib/rateLimit.js';
import { __resetCheckInCache } from '../api/_lib/checkins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RETIRED = [
  'checkin',
  'lunch',
  'project-upload',
  'teams',
  'admin/checkins',
  'admin/project-settings',
  'admin/projects',
  'admin/stats',
  'admin/teams',
];

/** The middleware the dev server installs for /api, run without a server. */
function devMiddleware() {
  let middleware;
  const plugin = devApiPlugin();
  const cwd = process.cwd();
  process.chdir(root); // the plugin resolves api/ from the working directory
  try {
    plugin.configureServer({ middlewares: { use: (fn) => (middleware = fn) } });
  } finally {
    process.chdir(cwd);
  }
  return async (options) => {
    const res = createResponse();
    await middleware(createRequest(options), res, () => {
      res.statusCode = -1; // "not an API request" — should never happen here
    });
    return res;
  };
}

test('no route file exists for any retired endpoint', () => {
  for (const route of RETIRED) {
    assert.equal(fs.existsSync(path.join(root, 'api', `${route}.js`)), false, `api/${route}.js still exists`);
  }
});

test('the deployment has exactly the five expected serverless functions', () => {
  // Vercel turns every api/**/*.js outside an underscore-prefixed path into a
  // function. Hobby projects are capped at 12 per deployment.
  const functions = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) functions.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(root, 'api'));
  assert.deepEqual(functions.sort(), [
    'api/admin/attendees.js',
    'api/admin/login.js',
    'api/admin/logout.js',
    'api/admin/session.js',
    'api/verify.js',
  ]);
});

test('every retired endpoint answers 404 for every method and touches no data', async () => {
  process.env.REGISTRATION_SHEET_ID = TEST_SHEET_ID;
  process.env.REGISTRATION_SHEET_NAME = TEST_TAB;
  const fake = createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: REGISTRATION_ROWS } }, { readOnlyTabs: [TEST_TAB] });
  const restore = installFakeSheets(fake);
  const run = devMiddleware();
  try {
    for (const route of RETIRED) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const res = await run({
          method,
          url: `/api/${route}?size=3`,
          body: method === 'GET' ? undefined : { email: 'asha.verma@example.com', password: 'x', teams: [] },
        });
        assert.equal(res.statusCode, 404, `${method} /api/${route}`);
        assert.deepEqual(res.json(), { success: false, status: 'NOT_FOUND' });
        assert.equal(res.headers['set-cookie'], undefined);
      }
    }
    assert.equal(fake.calls.get, 0, 'a retired route read the sheet');
    assert.equal(fake.calls.writes.length, 0, 'a retired route wrote to the sheet');
  } finally {
    restore();
  }
});

test('the same dev routing still serves /api/verify', async () => {
  process.env.REGISTRATION_SHEET_ID = TEST_SHEET_ID;
  process.env.REGISTRATION_SHEET_NAME = TEST_TAB;
  __resetRegistrationCache();
  __resetRateLimits();
  __resetCheckInCache();
  const fake = createFakeSheets({ [TEST_SHEET_ID]: { [TEST_TAB]: REGISTRATION_ROWS } }, { readOnlyTabs: [TEST_TAB] });
  const restore = installFakeSheets(fake);
  try {
    const res = await devMiddleware()({ method: 'POST', url: '/api/verify', body: { email: 'asha.verma@example.com' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, 'REGISTRATION_VERIFIED');
  } finally {
    restore();
  }
});
