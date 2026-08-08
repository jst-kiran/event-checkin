/**
 * Reads .env into process.env for local development.
 *
 * Vite's own loadEnv() is not used: it gives process.env precedence over the
 * file, and with an empty prefix that applies to every key. Since Vite restarts
 * in-process when .env changes, a value read once would survive every later
 * edit — you would fix a credential, watch the server restart, and still be
 * running with the old one.
 *
 * Only process.env is touched. The client bundle still receives VITE_* and
 * nothing else, so no secret here can reach the browser.
 *
 * On Vercel this file never runs; the platform injects the environment itself.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * KEY=value, one per line.
 *
 * The spacing around `=` is matched with [ \t]* rather than \s*, which matters
 * more than it looks: \s includes newlines, so an empty `FOO=` would consume
 * the line break and swallow the *next* line as its value. That silently drops
 * a variable and is maddening to debug — an empty GOOGLE_SHEET_ID would eat
 * ADMIN_EMAIL and leave admin login mysteriously unconfigured.
 *
 * The double-quoted alternative is allowed to span lines, because a PEM private
 * key pasted verbatim needs exactly that.
 */
const LINE = /^[ \t]*([\w.-]+)[ \t]*=[ \t]*("(?:[^"\\]|\\[\s\S])*"|'[^']*'|[^\n]*)/gm;

/** @returns {Object<string,string>} the parsed pairs, for testing */
export function parseDotEnv(raw) {
  const values = {};
  LINE.lastIndex = 0;

  let match;
  while ((match = LINE.exec(raw)) !== null) {
    let value = match[2].trim();

    // Strip one layer of wrapping quotes, leaving anything inside — including
    // a '#' or spaces — intact.
    if (value.length > 1 && /^(['"]).*\1$/s.test(value)) value = value.slice(1, -1);

    values[match[1]] = value;
  }

  return values;
}

/** Loads .env then .env.local, with later files winning. */
export default function loadDotEnv(dir) {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;

    for (const [key, value] of Object.entries(parseDotEnv(fs.readFileSync(file, 'utf8')))) {
      process.env[key] = value;
    }
  }
}
