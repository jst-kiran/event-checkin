/**
 * Project-wide guarantees that are easiest to check by reading the source:
 * the previous event's data is never loaded, nothing can write to Google
 * Sheets, and no server-side configuration leaks into the browser bundle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(rel, extensions));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(rel);
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SERVER = [...filesUnder('api', ['.js']), ...filesUnder('scripts', ['.js'])];
const CLIENT = filesUnder('src', ['.js', '.jsx']);

test('no server code reads the old registration snapshot or the old sheet variable', () => {
  for (const file of SERVER) {
    const source = read(file);
    for (const banned of ['registrations.json', "'data/", '"data/', 'REGISTRATIONS_PATH', 'GOOGLE_SHEET_ID', 'readFileSync']) {
      assert.equal(source.includes(banned), false, `${file} references ${banned}`);
    }
  }
});

test('the serverless bundle no longer ships the data/ folder', () => {
  const config = JSON.parse(read('vercel.json'));
  for (const fn of Object.values(config.functions || {})) {
    assert.equal(fn.includeFiles, undefined);
  }
});

test('only the Google client talks to Google, and every write in it is guarded', () => {
  for (const file of SERVER) {
    if (file.replace(/\\/g, '/') === 'api/_lib/googleSheets.js') continue;
    const source = read(file);
    for (const banned of ['googleapis.com', 'fetch(']) {
      assert.equal(source.includes(banned), false, `${file} contains ${banned}`);
    }
  }

  const client = read('api/_lib/googleSheets.js');
  // Each exported write function asserts the target tab before doing anything.
  for (const name of ['appendSheetRow', 'updateSheetValues', 'createCheckInTab']) {
    const body = client.slice(client.indexOf(`export async function ${name}(`));
    const firstStatement = body.slice(body.indexOf(') {\n') + 3).trim().split('\n')[0];
    assert.equal(firstStatement, 'assertWritableTab(sheetName);', `${name} must start with the write guard`);
  }
  // Reads use the read-only scope; only non-GET requests ask for the write scope.
  assert.match(client, /const scope = method === 'GET' \? READ_SCOPE : WRITE_SCOPE;/);
});

test('registration rows are only ever read — nothing writes through the registration module', () => {
  const registrations = read('api/_lib/registrations.js');
  for (const banned of ['appendSheetRow', 'updateSheetValues', 'createCheckInTab']) {
    assert.equal(registrations.includes(banned), false);
  }
});

test('the browser bundle holds no credential, sheet ID or old endpoint', () => {
  for (const file of CLIENT) {
    const source = read(file);
    for (const banned of ['GOOGLE_', 'REGISTRATION_SHEET', 'PRIVATE KEY', 'spreadsheets/d/', '/api/checkin', '/api/lunch', '/api/project-upload', '/api/teams', '/api/admin/stats', '/api/admin/checkins', '/api/admin/teams', '/api/admin/projects']) {
      assert.equal(source.includes(banned), false, `${file} contains ${banned}`);
    }
  }
});

test('the router serves the desk at / and /checkin, the organizer area at /admin, nothing else', () => {
  const app = read('src/App.jsx');
  const paths = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(paths, ['/', '/checkin', '/admin/login', '/admin', '*']);
  assert.match(app, /<ProtectedRoute>\s*<AdminDashboard \/>\s*<\/ProtectedRoute>/);
  assert.match(app, /path="\/" element=\{<CheckIn \/>\}/);
  assert.match(app, /path="\/checkin" element=\{<CheckIn \/>\}/);
  assert.match(app, /path="\*" element=\{<Navigate to="\/checkin" replace \/>\}/);
});

test('the exact not-found sentence is shown by the UI and sent by the API', () => {
  const sentence = 'Registration Not Found — Please check the email address or contact the event organizers.';
  const messages = read('src/utils/messages.js');
  assert.match(messages, /title: 'Registration Not Found',\s*description: 'Please check the email address or contact the event organizers\.',\s*joined: true/);
  const panel = read('src/components/StatusPanel.jsx');
  assert.match(panel, /\{description \? ` \\u2014 \$\{description\}` : null\}/);
  return import('../api/_lib/responses.js').then(({ NOT_FOUND_MESSAGE }) => {
    assert.equal(NOT_FOUND_MESSAGE, sentence);
  });
});
