/**
 * The Google client's configuration handling.
 *
 * No test here touches the network. What is covered is the part that actually
 * breaks deployments: the private key arrives from .env with literal \n escapes
 * and from the Vercel dashboard as a real multi-line value, and both have to
 * end up as a usable PEM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as sheetsModule from '../api/_lib/googleSheets.js';

const {
  readCredentials: readConfig,
  isConfigured,
  SheetsError,
  READ_SCOPE,
  WRITE_SCOPE,
  getSheetValues,
  appendSheetRow,
  updateSheetValues,
  createCheckInTab,
  assertWritableTab,
  checkInSheetName,
  googleSheets,
  __resetTokenCache,
} = sheetsModule;

/** A genuine key pair, so "was it parsed into something usable" is a real question. */
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function withEnv(vars, run) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  let result;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  // Async callbacks keep the variables until they settle.
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

const BASE = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@project.iam.gserviceaccount.com',
};

test('a genuine multi-line key is accepted as-is', () => {
  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: PEM }, () => {
    const config = readConfig();
    assert.ok(config.privateKey.includes('-----BEGIN PRIVATE KEY-----'));
    // It must still be a key crypto can sign with, not just a string.
    assert.doesNotThrow(() => crypto.createSign('RSA-SHA256').update('x').sign(config.privateKey));
  });
});

test('a key stored with literal \\n escapes is restored to real newlines', () => {
  const escaped = PEM.replace(/\n/g, '\\n');

  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: escaped }, () => {
    const config = readConfig();
    assert.equal(config.privateKey.includes('\\n'), false, 'escapes should be gone');
    assert.doesNotThrow(() => crypto.createSign('RSA-SHA256').update('x').sign(config.privateKey));
  });
});

test('a key wrapped in quotes by a .env parser is unwrapped', () => {
  const quoted = `"${PEM.replace(/\n/g, '\\n')}"`;

  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: quoted }, () => {
    const config = readConfig();
    assert.equal(config.privateKey.startsWith('"'), false);
    assert.doesNotThrow(() => crypto.createSign('RSA-SHA256').update('x').sign(config.privateKey));
  });
});

test('carriage returns from a Windows paste are stripped', () => {
  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: PEM.replace(/\n/g, '\r\n') }, () => {
    const config = readConfig();
    assert.equal(config.privateKey.includes('\r'), false);
    assert.doesNotThrow(() => crypto.createSign('RSA-SHA256').update('x').sign(config.privateKey));
  });
});

test('each missing variable is named, so the fix is obvious', () => {
  withEnv(
    {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
      GOOGLE_PRIVATE_KEY: undefined,
    },
    () => {
      assert.throws(readConfig, (error) => {
        assert.ok(error instanceof SheetsError);
        assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
        assert.match(error.message, /GOOGLE_PRIVATE_KEY/);
        return true;
      });
    }
  );
});

test('a value that is not a PEM key is rejected before any request', () => {
  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: 'just-some-string' }, () => {
    assert.throws(readConfig, /does not look like a PEM private key/);
  });
});

test('isConfigured reflects whether the deployment can reach the sheet', () => {
  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: PEM }, () => {
    assert.equal(isConfigured(), true);
  });
  withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: undefined }, () => {
    assert.equal(isConfigured(), false);
  });
});

test('surrounding whitespace in the service account email is trimmed', () => {
  withEnv(
    {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '  svc@project.iam.gserviceaccount.com  ',
      GOOGLE_PRIVATE_KEY: PEM,
    },
    () => {
      const config = readConfig();
      assert.equal(config.clientEmail, 'svc@project.iam.gserviceaccount.com');
      assert.equal('spreadsheetId' in config, false, 'which sheet to read is not a credential');
    }
  );
});

test('SheetsError carries whether the failure is worth retrying', () => {
  assert.equal(new SheetsError('x').retryable, false);
  assert.equal(new SheetsError('x', { retryable: true }).retryable, true);
  assert.equal(new SheetsError('x', { httpStatus: 503 }).httpStatus, 503);
});

/* ==========================================================================
 * Read scope for reads; writes only to the check-in tab
 * ========================================================================== */

const SHEET = '1FakeSheetIdUsedOnlyByAutomatedTests000000';
const TABS = { REGISTRATION_SHEET_NAME: 'Form responses 1', CHECKIN_SHEET_NAME: undefined };

test('the scopes are what they claim to be', () => {
  assert.equal(READ_SCOPE, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  assert.equal(WRITE_SCOPE, 'https://www.googleapis.com/auth/spreadsheets');
  assert.deepEqual(Object.keys(googleSheets).sort(), ['appendSheetRow', 'createCheckInTab', 'getSheetValues', 'updateSheetValues']);
});

test('the write guard allows only the check-in tab', () => {
  withEnv(TABS, () => {
    assert.equal(checkInSheetName(), 'CheckIns');
    assert.doesNotThrow(() => assertWritableTab('CheckIns'));
    for (const tab of ['Form responses 1', 'form responses 1', 'Sheet1', 'checkins', '', undefined]) {
      assert.throws(() => assertWritableTab(tab), SheetsError, `allowed ${tab}`);
    }
  });
});

test('the write guard refuses everything if the check-in tab is configured as the registration tab', () => {
  for (const name of ['Form responses 1', 'FORM RESPONSES 1', 'Form responses 1 ']) {
    withEnv({ ...TABS, CHECKIN_SHEET_NAME: name }, () => {
      assert.throws(() => assertWritableTab(checkInSheetName()), /other than the registration tab/);
    });
  }
});

test('every write function refuses the registration tab before any network call', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('network must not be touched');
  };
  try {
    await withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: PEM, ...TABS }, async () => {
      await assert.rejects(appendSheetRow(SHEET, 'Form responses 1', ['x']), /Refusing to write/);
      await assert.rejects(updateSheetValues(SHEET, 'Form responses 1', 'A1', [['x']]), /Refusing to write/);
      await assert.rejects(createCheckInTab(SHEET, 'Form responses 1', { headers: ['x'] }), /Refusing to write/);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

/**
 * Runs `operation` against a stubbed fetch and returns every request made, so
 * the exact wire behaviour can be asserted without a network.
 */
async function capture(operation, sheetsResponse = () => new Response('{}', { status: 200 })) {
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || 'GET', body: init.body ? String(init.body) : '' };
    requests.push(entry);
    if (entry.url.startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(entry.body).get('assertion');
      entry.scope = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString()).scope;
      return new Response(JSON.stringify({ access_token: `token-for-${entry.scope}`, expires_in: 3600 }), { status: 200 });
    }
    return sheetsResponse(entry);
  };
  __resetTokenCache();
  try {
    let result, error;
    try {
      result = await withEnv({ ...BASE, GOOGLE_PRIVATE_KEY: PEM, ...TABS }, () => operation());
    } catch (caught) {
      error = caught;
    }
    return { requests, result, error };
  } finally {
    globalThis.fetch = realFetch;
    __resetTokenCache();
  }
}

test('a read is a GET with formatted values, using the read-only token', async () => {
  const values = [['Timestamp', 'Full Name'], ['07/10/2026 10:00:00', 'Asha Verma']];
  const { requests, result } = await capture(
    () => getSheetValues(SHEET, 'Form responses 1'),
    () => new Response(JSON.stringify({ values }), { status: 200 })
  );
  assert.deepEqual(result, values);
  const [token, read] = requests;
  assert.equal(token.scope, READ_SCOPE);
  assert.equal(read.method, 'GET');
  const url = new URL(read.url);
  assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SHEET}/values/'Form responses 1'`);
  assert.equal(url.searchParams.get('valueRenderOption'), 'FORMATTED_VALUE');
});

test('an append targets only the CheckIns tab, as RAW text, with the write token', async () => {
  const { requests, result } = await capture(
    () => appendSheetRow(SHEET, 'CheckIns', ['t', 'a@example.com', '=1+1']),
    () => new Response(JSON.stringify({ updates: { updatedRange: "'CheckIns'!A7:J7" } }), { status: 200 })
  );
  assert.deepEqual(result, { rowNumber: 7 });
  const [token, append] = requests;
  assert.equal(token.scope, WRITE_SCOPE);
  assert.equal(append.method, 'POST');
  const url = new URL(append.url);
  assert.equal(decodeURIComponent(url.pathname), `/v4/spreadsheets/${SHEET}/values/'CheckIns':append`);
  assert.equal(url.searchParams.get('valueInputOption'), 'RAW', 'a formula-looking value stays text');
  assert.equal(url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
  assert.deepEqual(JSON.parse(append.body), { values: [['t', 'a@example.com', '=1+1']] });
});

test('creating the CheckIns tab touches only the new tab and adds the highlight rules', async () => {
  const { requests } = await capture(() =>
    createCheckInTab(SHEET, 'CheckIns', {
      headers: ['Timestamp', 'E-mail address', 'Full Name', 'Enrollment Number', 'Semester', 'Course', 'Specialization', 'Method', 'Checked In By', 'Status'],
      highlights: [
        { column: 7, equals: 'Manual', color: '#FEF3C7' },
        { column: 7, equals: 'Walk-in', color: '#EDE9FE' },
      ],
    })
  );
  const batch = requests.find((r) => r.url.endsWith(':batchUpdate'));
  const { requests: ops } = JSON.parse(batch.body);
  const sheetId = ops[0].addSheet.properties.sheetId;

  assert.equal(ops[0].addSheet.properties.title, 'CheckIns');
  assert.equal(ops[0].addSheet.properties.gridProperties.frozenRowCount, 1);
  // Every operation is scoped to the sheet being created — none can reach another tab.
  assert.equal(ops[1].updateCells.start.sheetId, sheetId);
  const rules = ops.filter((op) => op.addConditionalFormatRule).map((op) => op.addConditionalFormatRule.rule);
  assert.deepEqual(rules.map((r) => r.ranges[0].sheetId), [sheetId, sheetId]);
  assert.deepEqual(rules.map((r) => r.booleanRule.condition.values[0].userEnteredValue), ['=$H2="Manual"', '=$H2="Walk-in"']);
  assert.equal(ops.length, 4);
});

test('a tab created concurrently by another instance is not an error', async () => {
  const { error } = await capture(
    () => createCheckInTab(SHEET, 'CheckIns', { headers: ['x'] }),
    () => new Response(JSON.stringify({ error: { message: 'A sheet with the name "CheckIns" already exists.' } }), { status: 400 })
  );
  assert.equal(error, undefined);
});

test('a 403 explains what access the service account is missing', async () => {
  const forbidden = () => new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: 403 });
  const read = await capture(() => getSheetValues(SHEET, 'Form responses 1'), forbidden);
  assert.match(read.error.message, /share the spreadsheet/);
  assert.equal(read.error.retryable, false);
  const write = await capture(() => appendSheetRow(SHEET, 'CheckIns', ['x']), forbidden);
  assert.match(write.error.message, /needs Editor access/);
});

test('a missing spreadsheet ID or tab name is refused before any request', async () => {
  await assert.rejects(getSheetValues('', 'Form responses 1'), /No spreadsheet ID/);
  await assert.rejects(getSheetValues(SHEET, ''), /No sheet/);
});
