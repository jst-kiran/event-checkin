import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = 'test-session-secret-value-long-enough';
process.env.ADMIN_EMAIL = 'organizer@example.com';
process.env.ADMIN_PASSWORD = 'correct horse battery staple';

const {
  createSessionToken,
  verifySessionToken,
  verifyCredentials,
  getSession,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  isAuthConfigured,
  COOKIE_NAME,
} = await import('../api/_lib/auth.js');

const { createRequest, createResponse } = await import('./helpers/http.js');

const withCookie = (value) => createRequest({ headers: { cookie: `${COOKIE_NAME}=${value}` } });

test('a freshly issued token verifies', () => {
  const claims = verifySessionToken(createSessionToken('organizer@example.com'));
  assert.equal(claims.sub, 'organizer@example.com');
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));
});

test('a token with an edited payload is rejected', () => {
  const token = createSessionToken('organizer@example.com');
  const [body] = token.split('.');

  // Decode, escalate, re-encode — but the signature still covers the old body.
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  claims.sub = 'attacker@example.com';
  const forgedBody = Buffer.from(JSON.stringify(claims)).toString('base64url');

  assert.equal(verifySessionToken(`${forgedBody}.${token.split('.')[1]}`), null);
});

test('a token cannot be given a later expiry', () => {
  const token = createSessionToken('organizer@example.com');
  const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  claims.exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;

  const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
  assert.equal(verifySessionToken(`${forged}.${token.split('.')[1]}`), null);
});

test('a token signed with a different key is rejected', () => {
  const body = Buffer.from(
    JSON.stringify({ sub: 'attacker@example.com', exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', 'the-wrong-secret-entirely')
    .update(body)
    .digest('base64url');

  assert.equal(verifySessionToken(`${body}.${signature}`), null);
});

test('an expired token is rejected', () => {
  const body = Buffer.from(
    JSON.stringify({ sub: 'organizer@example.com', iat: 0, exp: Math.floor(Date.now() / 1000) - 1 })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(body)
    .digest('base64url');

  // Correctly signed, genuinely ours — and still refused, because it lapsed.
  assert.equal(verifySessionToken(`${body}.${signature}`), null);
});

test('malformed tokens are rejected without throwing', () => {
  for (const token of [
    '',
    '.',
    'no-dot-at-all',
    'a.',
    '.b',
    'not-base64.not-base64',
    'a'.repeat(5000),
    null,
    undefined,
    12345,
    {},
  ]) {
    assert.equal(verifySessionToken(token), null, `should reject ${JSON.stringify(token)}`);
  }
});

test('a valid signature over a non-session payload is still rejected', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(body)
    .digest('base64url');

  assert.equal(verifySessionToken(`${body}.${signature}`), null);
});

test('correct credentials are accepted', () => {
  assert.equal(verifyCredentials('organizer@example.com', 'correct horse battery staple'), true);
});

test('the admin email is matched case-insensitively', () => {
  assert.equal(verifyCredentials('  ORGANIZER@Example.COM  ', 'correct horse battery staple'), true);
});

test('wrong credentials are refused', () => {
  const cases = [
    ['organizer@example.com', 'wrong'],
    ['organizer@example.com', ''],
    ['attacker@example.com', 'correct horse battery staple'],
    ['', ''],
    [null, null],
    [undefined, undefined],
    ['organizer@example.com', 'correct horse battery stapl'],
    ['organizer@example.com', 'Correct horse battery staple'],
  ];

  for (const [email, password] of cases) {
    assert.equal(verifyCredentials(email, password), false, `should refuse ${email} / ${password}`);
  }
});

test('the password comparison is not a prefix match', () => {
  assert.equal(verifyCredentials('organizer@example.com', 'correct'), false);
  assert.equal(verifyCredentials('organizer@example.com', 'correct horse battery staple '), false);
});

test('getSession reads a valid cookie and ignores everything else', () => {
  const token = createSessionToken('organizer@example.com');

  assert.equal(getSession(withCookie(token)).sub, 'organizer@example.com');
  assert.equal(getSession(createRequest({})), null);
  assert.equal(getSession(createRequest({ headers: { cookie: 'other=value' } })), null);
  assert.equal(getSession(withCookie('garbage')), null);
});

test('flipping one character of the cookie invalidates it', () => {
  const token = createSessionToken('organizer@example.com');
  const tampered = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');

  assert.equal(getSession(withCookie(tampered)), null);
});

test('the session cookie is HttpOnly and SameSite=Strict', () => {
  const res = createResponse();
  setSessionCookie(res, createSessionToken('organizer@example.com'));

  const cookie = res.getHeader('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=\d+/);
});

test('the cookie is marked Secure in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = createResponse();
    setSessionCookie(res, 'token');
    assert.match(res.getHeader('set-cookie'), /Secure/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('logout expires the cookie immediately', () => {
  const res = createResponse();
  clearSessionCookie(res);

  const cookie = res.getHeader('set-cookie');
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
});

test('requireAdmin writes a 401 for an anonymous caller', () => {
  const res = createResponse();
  assert.equal(requireAdmin(createRequest({}), res), null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().status, 'UNAUTHORIZED');
});

test('requireAdmin passes a signed-in caller through untouched', () => {
  const res = createResponse();
  const session = requireAdmin(withCookie(createSessionToken('organizer@example.com')), res);

  assert.equal(session.sub, 'organizer@example.com');
  assert.equal(res.writableEnded, false);
});

test('a missing SESSION_SECRET disables sessions rather than weakening them', async () => {
  const previous = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;

  // Re-imported so the module re-reads the environment for this case.
  const fresh = await import(`../api/_lib/auth.js?case=${Math.random()}`);
  try {
    assert.equal(fresh.isAuthConfigured(), false);
    assert.throws(() => fresh.createSessionToken('organizer@example.com'), /SESSION_SECRET/);
    assert.equal(fresh.verifySessionToken('anything.at-all'), null);
  } finally {
    process.env.SESSION_SECRET = previous;
  }
});

test('a too-short SESSION_SECRET is refused', async () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'short';

  const fresh = await import(`../api/_lib/auth.js?case=${Math.random()}`);
  try {
    assert.equal(fresh.isAuthConfigured(), false);
  } finally {
    process.env.SESSION_SECRET = previous;
  }
});

test('isAuthConfigured requires all three variables', () => {
  assert.equal(isAuthConfigured(), true);

  const previous = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    assert.equal(isAuthConfigured(), false);
    assert.equal(verifyCredentials('organizer@example.com', 'anything'), false);
  } finally {
    process.env.ADMIN_PASSWORD = previous;
  }
});
