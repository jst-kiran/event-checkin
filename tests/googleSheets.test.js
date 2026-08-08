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
import { readConfig, isConfigured, columnLetter, SHEET_NAMES, SheetsError } from '../api/_lib/googleSheets.js';

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
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const BASE = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@project.iam.gserviceaccount.com',
  GOOGLE_SHEET_ID: 'sheet-id-123',
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
      GOOGLE_SHEET_ID: undefined,
    },
    () => {
      assert.throws(readConfig, (error) => {
        assert.ok(error instanceof SheetsError);
        assert.match(error.message, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
        assert.match(error.message, /GOOGLE_PRIVATE_KEY/);
        assert.match(error.message, /GOOGLE_SHEET_ID/);
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

test('surrounding whitespace in the email and sheet id is trimmed', () => {
  withEnv(
    {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: '  svc@project.iam.gserviceaccount.com  ',
      GOOGLE_SHEET_ID: '  sheet-id-123\n',
      GOOGLE_PRIVATE_KEY: PEM,
    },
    () => {
      const config = readConfig();
      assert.equal(config.clientEmail, 'svc@project.iam.gserviceaccount.com');
      assert.equal(config.spreadsheetId, 'sheet-id-123');
    }
  );
});

test('tab names default sensibly and can be overridden', () => {
  assert.equal(SHEET_NAMES.registrations, 'Registrations');
  assert.equal(SHEET_NAMES.checkIn, 'CheckIn');
  assert.equal(SHEET_NAMES.lunch, 'Lunch');

  withEnv({ SHEET_CHECKIN: 'Arrivals' }, () => {
    assert.equal(SHEET_NAMES.checkIn, 'Arrivals');
  });
});

test('columnLetter converts indexes the way A1 notation expects', () => {
  assert.equal(columnLetter(0), 'A');
  assert.equal(columnLetter(7), 'H');
  assert.equal(columnLetter(25), 'Z');
  assert.equal(columnLetter(26), 'AA');
  assert.equal(columnLetter(27), 'AB');
  assert.equal(columnLetter(51), 'AZ');
  assert.equal(columnLetter(52), 'BA');
});

test('SheetsError carries whether the failure is worth retrying', () => {
  assert.equal(new SheetsError('x').retryable, false);
  assert.equal(new SheetsError('x', { retryable: true }).retryable, true);
  assert.equal(new SheetsError('x', { httpStatus: 503 }).httpStatus, 503);
});
