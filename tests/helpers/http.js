/**
 * Fake `req`/`res` pairs, plus the seam that lets a route handler run against
 * an in-memory spreadsheet.
 *
 * The request is a real Readable, because that is what the body reader
 * consumes — including the oversized-body path, which has to be exercised as a
 * stream rather than as a pre-parsed object.
 */

import { Readable } from 'node:stream';
import { googleSheets } from '../../api/_lib/googleSheets.js';

export function createRequest({ method = 'GET', url = '/', headers = {}, body, rawBody } = {}) {
  const payload = rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : '';

  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.url = url;
  req.headers = { ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

export function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    writableEnded: false,

    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    end(payload) {
      this.body = payload;
      this.writableEnded = true;
    },

    /** The parsed JSON payload the client would receive. */
    json() {
      return this.body === undefined ? null : JSON.parse(this.body);
    },
  };
}

/** Runs a handler and hands back the finished response. */
export async function call(handler, requestOptions) {
  const res = createResponse();
  await handler(createRequest(requestOptions), res);
  return res;
}

/**
 * Points the real route handlers at a fake spreadsheet.
 *
 * The handlers call checkInAttendee() without arguments, so the injection point
 * is the shared `googleSheets` object they ultimately reach. Swapping its three
 * methods keeps the entire production path — routing, validation, status
 * mapping, concurrency — under test, with only the network replaced.
 *
 * @returns {() => void} restores the real methods
 */
export function installFakeSheets(fake) {
  const original = {
    getSheetValues: googleSheets.getSheetValues,
    appendSheetRow: googleSheets.appendSheetRow,
    updateSheetValues: googleSheets.updateSheetValues,
  };

  googleSheets.getSheetValues = fake.sheets.getSheetValues;
  googleSheets.appendSheetRow = fake.sheets.appendSheetRow;
  googleSheets.updateSheetValues = fake.sheets.updateSheetValues;

  return () => Object.assign(googleSheets, original);
}
