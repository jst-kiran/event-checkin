import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'registrations.json');

/**
 * The registration module caches the parsed snapshot for the life of the
 * process — correct in production, where the data cannot change, but it means
 * a test that needs different data must re-import the module with a fresh URL
 * rather than just resetting a variable.
 */
async function loadWith(snapshotPath) {
  process.env.REGISTRATIONS_PATH = snapshotPath;
  return import(`../api/_lib/registrations.js?case=${Math.random()}`);
}

function writeTemp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-reg-'));
  const file = path.join(dir, 'registrations.json');
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

test('finds a registration by exact email', async () => {
  const { findRegistrationByEmail } = await loadWith(FIXTURE);
  const attendee = findRegistrationByEmail('john@example.com');

  assert.equal(attendee.name, 'John Doe');
  assert.equal(attendee.organization, 'ABC Corp');
  assert.equal(attendee.mealPreference, 'Jain Veg Meal');
});

test('lookup ignores case and surrounding whitespace', async () => {
  const { findRegistrationByEmail } = await loadWith(FIXTURE);

  for (const input of ['JOHN@EXAMPLE.COM', '  John@Example.Com  ', '\tjohn@example.com\n']) {
    assert.equal(findRegistrationByEmail(input)?.email, 'john@example.com', `failed for ${input}`);
  }
});

test('an unregistered or empty email finds nothing', async () => {
  const { findRegistrationByEmail } = await loadWith(FIXTURE);

  for (const input of ['nobody@example.com', '', null, undefined, 'john@example.com.evil.com']) {
    assert.equal(findRegistrationByEmail(input), null, `should not match ${input}`);
  }
});

test('registration records are frozen against accidental mutation', async () => {
  const { findRegistrationByEmail } = await loadWith(FIXTURE);
  const attendee = findRegistrationByEmail('john@example.com');

  // A caller that edits what it was handed must not corrupt the guest list for
  // every later request on the same warm instance.
  assert.throws(() => {
    'use strict';
    attendee.name = 'Someone Else';
  });
  assert.equal(findRegistrationByEmail('john@example.com').name, 'John Doe');
});

test('counts unique registrations', async () => {
  const { getRegistrationCount, getAllRegistrations } = await loadWith(FIXTURE);
  assert.equal(getRegistrationCount(), 6);
  assert.equal(getAllRegistrations().length, 6);
});

test('publicAttendee withholds phone and designation', async () => {
  const { findRegistrationByEmail, publicAttendee } = await loadWith(FIXTURE);
  const payload = publicAttendee(findRegistrationByEmail('john@example.com'));

  assert.deepEqual(Object.keys(payload).sort(), ['email', 'mealPreference', 'name']);
  assert.equal(JSON.stringify(payload).includes('9999999999'), false);
  assert.equal(publicAttendee(null), null);
});

test('a bare array snapshot loads too', async () => {
  const file = writeTemp([{ name: 'Solo', email: 'Solo@Example.com' }]);
  const { findRegistrationByEmail, getSnapshotInfo } = await loadWith(file);

  assert.equal(findRegistrationByEmail('solo@example.com').name, 'Solo');
  assert.equal(getSnapshotInfo().version, 'unversioned');
});

test('rows without an email are skipped rather than crashing the load', async () => {
  const file = writeTemp({
    attendees: [{ name: 'No Email' }, { name: 'Fine', email: 'fine@example.com' }, {}],
  });
  const { getRegistrationCount, findRegistrationByEmail } = await loadWith(file);

  assert.equal(getRegistrationCount(), 1);
  assert.equal(findRegistrationByEmail('fine@example.com').name, 'Fine');
});

test('a hand-edited duplicate cannot become two attendees', async () => {
  const file = writeTemp({
    attendees: [
      { name: 'First', email: 'dup@example.com' },
      { name: 'Second', email: 'DUP@example.com' },
    ],
  });
  const { getRegistrationCount, findRegistrationByEmail } = await loadWith(file);

  assert.equal(getRegistrationCount(), 1);
  assert.equal(findRegistrationByEmail('dup@example.com').name, 'First');
});

test('an attendee with no name still gets greeted', async () => {
  const file = writeTemp({ attendees: [{ email: 'anon@example.com' }] });
  const { findRegistrationByEmail } = await loadWith(file);

  assert.equal(findRegistrationByEmail('anon@example.com').name, 'Attendee');
});

test('a missing snapshot fails loudly instead of admitting everyone', async () => {
  const { findRegistrationByEmail } = await loadWith(
    path.join(os.tmpdir(), 'definitely-not-here-registrations.json')
  );

  // Failing closed is the point: a deployment that forgot the snapshot must
  // error, not silently treat the guest list as empty *or* as unrestricted.
  assert.throws(() => findRegistrationByEmail('john@example.com'), /not found/i);
});

test('a corrupt snapshot fails loudly', async () => {
  const file = writeTemp('{ this is not json');
  const { findRegistrationByEmail } = await loadWith(file);

  assert.throws(() => findRegistrationByEmail('john@example.com'), /not valid JSON/i);
});

test('a snapshot with no attendees array fails loudly', async () => {
  const file = writeTemp({ snapshotVersion: '2026-08-15' });
  const { findRegistrationByEmail } = await loadWith(file);

  assert.throws(() => findRegistrationByEmail('john@example.com'), /attendees/i);
});

test('snapshot metadata is reported for the dashboard', async () => {
  const { getSnapshotInfo } = await loadWith(FIXTURE);
  const info = getSnapshotInfo();

  assert.equal(info.version, '2026-08-15');
  assert.equal(info.total, 6);
  assert.equal(info.generatedAt, '2026-08-15T10:00:00.000Z');
});
