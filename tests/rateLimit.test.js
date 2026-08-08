import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, __resetRateLimits } from '../api/_lib/rateLimit.js';
import { clientKey, getQuery, readJsonBody, MAX_BODY_BYTES } from '../api/_lib/responses.js';
import { createRequest } from './helpers/http.js';

test('requests inside the limit are allowed', () => {
  __resetRateLimits();

  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit('a', { limit: 5, windowMs: 60_000 }).allowed, true, `request ${i + 1}`);
  }
});

test('the request past the limit is refused with a retry hint', () => {
  __resetRateLimits();
  for (let i = 0; i < 5; i++) rateLimit('b', { limit: 5, windowMs: 60_000 });

  const blocked = rateLimit('b', { limit: 5, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
});

test('one client hitting the limit does not affect another', () => {
  __resetRateLimits();
  for (let i = 0; i < 6; i++) rateLimit('noisy', { limit: 5, windowMs: 60_000 });

  assert.equal(rateLimit('quiet', { limit: 5, windowMs: 60_000 }).allowed, true);
});

test('the window reopens once it elapses', async () => {
  __resetRateLimits();
  const options = { limit: 2, windowMs: 30 };

  rateLimit('c', options);
  rateLimit('c', options);
  assert.equal(rateLimit('c', options).allowed, false);

  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(rateLimit('c', options).allowed, true);
});

test('clientKey prefers the left-most forwarded address', () => {
  const req = createRequest({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  assert.equal(clientKey(req), '203.0.113.9');
});

test('clientKey falls back to the socket address', () => {
  assert.equal(clientKey(createRequest({})), '127.0.0.1');
});

test('clientKey caps an oversized forwarded header', () => {
  const req = createRequest({ headers: { 'x-forwarded-for': 'x'.repeat(500) } });
  assert.ok(clientKey(req).length <= 64);
});

test('getQuery parses the query string', () => {
  assert.deepEqual(getQuery(createRequest({ url: '/api/admin/teams?teams=5' })), { teams: '5' });
  assert.deepEqual(getQuery(createRequest({ url: '/api/admin/teams' })), {});
});

test('readJsonBody returns an empty object for an empty body', async () => {
  assert.deepEqual(await readJsonBody(createRequest({ method: 'POST' })), {});
});

test('readJsonBody rejects a body over the size cap', async () => {
  const rawBody = JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES + 100) });
  assert.equal(await readJsonBody(createRequest({ method: 'POST', rawBody })), null);
});

test('readJsonBody rejects JSON that is not an object', async () => {
  for (const rawBody of ['[1,2]', '"text"', '7', 'true', 'null', '{oops']) {
    assert.equal(await readJsonBody(createRequest({ method: 'POST', rawBody })), null, rawBody);
  }
});

test('readJsonBody accepts a body Vercel already parsed', async () => {
  const req = createRequest({ method: 'POST' });
  req.body = { email: 'john@example.com' };

  assert.deepEqual(await readJsonBody(req), { email: 'john@example.com' });
});
