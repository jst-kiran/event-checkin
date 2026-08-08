/**
 * The snapshot generator, exercised as a real subprocess.
 *
 * Its contract is an exit code and a message an operator reads at a terminal,
 * so testing it any other way would test something else. Every run uses
 * --dry-run and --from, so no Google call is made and data/registrations.json
 * is never touched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', 'scripts', 'generate-registration-snapshot.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-snapshot-'));

function csv(contents) {
  const file = path.join(tempDir, `${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

/** @returns {{code: number, out: string}} combined stdout+stderr */
async function generate(file, extraArgs = []) {
  const args = [SCRIPT, '--from', file, '--dry-run', ...extraArgs];
  try {
    const { stdout, stderr } = await run(process.execPath, args);
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code ?? 1, out: (error.stdout || '') + (error.stderr || '') };
  }
}

const VALID = `Timestamp,Name,Email Address,Organization/University,Designation,Phone Number,Meal Preference
2026-08-01,John Doe,john@example.com,ABC Corp,Developer,9999999999,Jain Veg Meal
2026-08-02,Priya Sharma,priya@example.com,TUG,Analyst,8888888888,Veg Meal
`;

test('a clean export is accepted', async () => {
  const { code, out } = await generate(csv(VALID));

  assert.equal(code, 0);
  assert.match(out, /2 valid registrations/);
  assert.match(out, /--dry-run: nothing written/);
});

test('the resolved column mapping is printed for review', async () => {
  const { out } = await generate(csv(VALID));

  assert.match(out, /email\s+"Email Address"/);
  assert.match(out, /organization\s+"Organization\/University"/);
  assert.match(out, /mealPreference\s+"Meal Preference"/);
});

test('meal preferences are summarized so a surprise value gets noticed', async () => {
  const { out } = await generate(
    csv(`Name,Email,Meal Preference
A,a@example.com,Jain Veg Meal
B,b@example.com,Veg Meal
C,c@example.com,Vegan
`)
  );

  assert.match(out, /Meal preferences found/);
  assert.match(out, /Vegan/);
});

test('one email shared by two different people stops the run', async () => {
  const { code, out } = await generate(
    csv(`Name,Email
John Doe,shared@example.com
Priya,priya@example.com
Nikhil Saraf,shared@example.com
`)
  );

  assert.equal(code, 1, 'must not produce a snapshot');
  assert.match(out, /Conflicting registration email/i);
  assert.match(out, /shared@example\.com/);
  assert.match(out, /rows 2 and 4 differ on: name/);
  // The two names must appear side by side — that is what makes the cause obvious.
  assert.match(out, /row 2\s+name: "John Doe"/);
  assert.match(out, /row 4\s+name: "Nikhil Saraf"/);
});

test('a conflict on any identity field stops the run', async () => {
  for (const [column, a, b] of [
    ['Organization', 'Acme', 'Globex'],
    ['Designation', 'Student', 'Professor'],
    ['Phone number', '111', '222'],
    ['Meal Preference', 'Veg Meal', 'Jain Veg Meal'],
  ]) {
    const { code, out } = await generate(
      csv(`Name,Email,${column}
Same Person,shared@example.com,${a}
Same Person,shared@example.com,${b}
`)
    );
    assert.equal(code, 1, `${column} conflict should fail`);
    assert.match(out, /Conflicting registration email/i);
  }
});

test('an identical repeat submission is collapsed, not rejected', async () => {
  const { code, out } = await generate(
    csv(`Name,Email,Organization,Meal Preference
Mistry Yaksh,yaksh@example.com,JG University,Veg Meal
Priya,priya@example.com,TUG,Veg Meal
Mistry Yaksh,yaksh@example.com,JG University,Veg Meal
`)
  );

  // Filling the same form twice is not an error — both rows describe one person.
  assert.equal(code, 0);
  assert.match(out, /repeat submission\(s\) collapsed/i);
  assert.match(out, /rows 2 and 4/);
  assert.match(out, /2 valid registrations/);
});

test('a repeat submission differing only by case or spacing is still collapsed', async () => {
  const { code, out } = await generate(
    csv(`Name,Email,Organization
John,john@example.com,Acme
  JOHN  ,  JOHN@EXAMPLE.COM ,acme
`)
  );

  assert.equal(code, 0);
  assert.match(out, /repeat submission\(s\) collapsed/i);
  assert.match(out, /1 valid registrations/);
});

test('--email-column overrides which column is authoritative', async () => {
  // A Google Form with "collect email addresses" on produces exactly this:
  // an auto-collected column and a typed one that disagree.
  const file = csv(`Timestamp,Email Address,Name,Email
2026-08-03,auto@google.com,Deepanshu,typed@work.com
2026-08-03,auto@google.com,Nikhil,nikhil@work.com
`);

  const auto = await generate(file);
  assert.equal(auto.code, 1, 'defaults to Email Address, which collides here');
  assert.match(auto.out, /Conflicting registration email/i);

  const typed = await generate(file, ['--email-column', 'Email']);
  assert.equal(typed.code, 0, 'the typed column separates the two people');
  assert.match(typed.out, /email\s+"Email"\s+<- set explicitly/);
  assert.match(typed.out, /2 valid registrations/);
});

test('--email-column rejects a header that does not exist', async () => {
  const { code, out } = await generate(
    csv(`Name,Email\nJohn,john@example.com\n`),
    ['--email-column', 'Nope']
  );

  assert.equal(code, 1);
  assert.match(out, /does not match any header/i);
  assert.match(out, /Headers seen: Name, Email/);
});

test('a malformed email stops the run', async () => {
  const { code, out } = await generate(
    csv(`Name,Email
Good,good@example.com
Bad,not-an-email
`)
  );

  assert.equal(code, 1);
  assert.match(out, /malformed email/i);
  assert.match(out, /row 3/);
});

test('a missing email column stops the run and lists what was found', async () => {
  const { code, out } = await generate(
    csv(`Name,Organization
John,ABC
`)
  );

  assert.equal(code, 1);
  assert.match(out, /No email column found/i);
  assert.match(out, /Headers seen: Name, Organization/);
});

test('rows with no email are warned about and skipped', async () => {
  const { code, out } = await generate(
    csv(`Name,Email
John,john@example.com
Ghost,
Priya,priya@example.com
`)
  );

  assert.equal(code, 0);
  assert.match(out, /1 row\(s\) have no email/i);
  assert.match(out, /2 valid registrations/);
});

test('a missing name is a warning, not a failure', async () => {
  const { code, out } = await generate(
    csv(`Name,Email
,john@example.com
`)
  );

  assert.equal(code, 0);
  assert.match(out, /have no name/i);
});

test('header capitalization and spacing do not matter', async () => {
  const { code, out } = await generate(
    csv(`  full NAME , e-mail ,  MEAL PREFERENCE
John,john@example.com,Jain
`)
  );

  assert.equal(code, 0);
  assert.match(out, /1 valid registrations/);
});

test('quoted fields containing commas survive parsing', async () => {
  const { code, out } = await generate(
    csv(`Name,Email,Organization
"Doe, John",john@example.com,"Acme, Inc."
`)
  );

  assert.equal(code, 0);
  assert.match(out, /1 valid registrations/);
});

test('an empty export stops the run', async () => {
  const { code, out } = await generate(csv(''));

  assert.equal(code, 1);
  assert.match(out, /empty/i);
});

test('a header row with no data rows stops the run', async () => {
  const { code, out } = await generate(csv('Name,Email\n'));

  assert.equal(code, 1);
  assert.match(out, /No valid registrations/i);
});

test('a missing input file is reported clearly', async () => {
  const { code, out } = await generate(path.join(tempDir, 'nope.csv'));

  assert.equal(code, 1);
  assert.match(out, /CSV file not found/i);
});

test('running with no credentials and no file explains both options', async (t) => {
  // The script deliberately loads the project's own .env, so "no credentials
  // anywhere" is only reproducible where that file is absent — CI, or a fresh
  // clone. Clearing the variables from the child's environment is not enough,
  // because the file puts them back. Skipping is the honest option: the
  // alternative is moving a real credentials file aside to make a test pass.
  if (fs.existsSync(path.join(here, '..', '.env'))) {
    t.skip('a project .env exists, so the unconfigured path cannot be reached here');
    return;
  }

  const env = { ...process.env };
  delete env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete env.GOOGLE_PRIVATE_KEY;
  delete env.GOOGLE_SHEET_ID;

  try {
    await run(process.execPath, [SCRIPT, '--dry-run'], { env });
    assert.fail('should have exited non-zero');
  } catch (error) {
    const out = (error.stdout || '') + (error.stderr || '');
    assert.match(out, /Google credentials are not configured/i);
    assert.match(out, /--from export\.csv/);
  }
});
