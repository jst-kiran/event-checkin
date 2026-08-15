/**
 * Tests for GET/POST /api/admin/project-settings — the admin's control over
 * the project-submission deadline.
 *
 * Covers:
 * - Authentication is required, like every other /api/admin/* route
 * - The deadline round-trips through the sheet as an IST offset-ISO string
 * - A malformed datetime-local value is refused rather than silently stored
 * - Clearing the deadline reopens submissions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.REGISTRATIONS_PATH = path.join(here, 'fixtures', 'registrations.json');
process.env.SESSION_SECRET = 'test-session-secret-value-long-enough';

const projectSettingsRoute = (await import('../api/admin/project-settings.js')).default;

const { __resetSettingsCache } = await import('../api/_lib/settings.js');
const { call, installFakeSheets } = await import('./helpers/http.js');
const { createFakeSheets } = await import('./helpers/fakeSheets.js');
const { __resetRateLimits } = await import('../api/_lib/rateLimit.js');
const { createSessionToken, COOKIE_NAME } = await import('../api/_lib/auth.js');

const authCookie = () => ({
  cookie: `${COOKIE_NAME}=${createSessionToken('organizer@example.com')}`,
});

function setup(initial = {}) {
  __resetSettingsCache();
  __resetRateLimits();
  return createFakeSheets(initial);
}

test('GET /api/admin/project-settings refuses an anonymous caller', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectSettingsRoute, { method: 'GET', url: '/api/admin/project-settings' });
    assert.equal(res.statusCode, 401);
  } finally {
    restore();
  }
});

test('POST /api/admin/project-settings refuses an anonymous caller', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      body: { deadlineLocal: '2026-08-20T18:30' },
    });
    assert.equal(res.statusCode, 401);
  } finally {
    restore();
  }
});

test('/api/admin/project-settings allows only GET and POST', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    for (const method of ['PUT', 'DELETE']) {
      const res = await call(projectSettingsRoute, {
        method,
        url: '/api/admin/project-settings',
        headers: authCookie(),
      });
      assert.equal(res.statusCode, 405, `for ${method}`);
    }
  } finally {
    restore();
  }
});

test('GET returns no deadline before one has ever been set', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectSettingsRoute, {
      method: 'GET',
      url: '/api/admin/project-settings',
      headers: authCookie(),
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.deadline, null);
    assert.equal(data.deadlineLocal, '');
    assert.equal(data.isClosed, false);
  } finally {
    restore();
  }
});

test('POST stores the deadline as an IST offset-ISO string and GET round-trips it', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const postRes = await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      headers: authCookie(),
      body: { deadlineLocal: '2026-08-20T18:30' },
    });
    assert.equal(postRes.statusCode, 200);
    const posted = postRes.json();
    assert.equal(posted.deadline, '2026-08-20T18:30:00+05:30');
    assert.equal(posted.deadlineLocal, '2026-08-20T18:30');

    const getRes = await call(projectSettingsRoute, {
      method: 'GET',
      url: '/api/admin/project-settings',
      headers: authCookie(),
    });
    const fetched = getRes.json();
    assert.equal(fetched.deadline, '2026-08-20T18:30:00+05:30');
    assert.equal(fetched.deadlineLocal, '2026-08-20T18:30');
  } finally {
    restore();
  }
});

test('isClosed reflects whether the stored deadline is in the past', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      headers: authCookie(),
      body: { deadlineLocal: '2020-01-01T00:00' },
    });

    const res = await call(projectSettingsRoute, {
      method: 'GET',
      url: '/api/admin/project-settings',
      headers: authCookie(),
    });
    assert.equal(res.json().isClosed, true);
  } finally {
    restore();
  }
});

test('a malformed deadline is refused rather than silently stored', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    const res = await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      headers: authCookie(),
      body: { deadlineLocal: 'not-a-date' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().status, 'INVALID_REQUEST');

    const getRes = await call(projectSettingsRoute, {
      method: 'GET',
      url: '/api/admin/project-settings',
      headers: authCookie(),
    });
    assert.equal(getRes.json().deadline, null, 'the bad value was never stored');
  } finally {
    restore();
  }
});

test('clearing the deadline reopens submissions', async () => {
  const fake = setup();
  const restore = installFakeSheets(fake);

  try {
    await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      headers: authCookie(),
      body: { deadlineLocal: '2020-01-01T00:00' },
    });

    const cleared = await call(projectSettingsRoute, {
      method: 'POST',
      url: '/api/admin/project-settings',
      headers: authCookie(),
      body: { deadlineLocal: '' },
    });
    assert.equal(cleared.statusCode, 200);
    const data = cleared.json();
    assert.equal(data.deadline, null);
    assert.equal(data.isClosed, false);
  } finally {
    restore();
  }
});
