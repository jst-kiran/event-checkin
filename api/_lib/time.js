/**
 * Timestamps written into the spreadsheet.
 *
 * A bare UTC ISO string is unambiguous but useless to an organizer scanning
 * the sheet during an event in India — 09:15Z is not a time anyone at the desk
 * recognizes. A bare local string ("20/08/2026 14:45") is readable but cannot
 * be parsed reliably.
 *
 * So the sheet gets an offset ISO string: 2026-08-20T14:45:03+05:30. It shows
 * local wall-clock time, and `new Date()` still parses it exactly.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function eventTimeZone() {
  return process.env.EVENT_TIMEZONE || DEFAULT_TIMEZONE;
}

/** Minutes that `timeZone` is ahead of UTC at this instant (DST included). */
function offsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some locales render midnight as hour 24.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );

  // Seconds are the finest granularity we format, so rounding to the minute
  // cannot lose information here.
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} [date]
 * @param {string} [timeZone] defaults to EVENT_TIMEZONE
 * @returns {string} e.g. "2026-08-20T14:45:03+05:30"
 */
export function formatTimestamp(date = new Date(), timeZone = eventTimeZone()) {
  let offset;
  try {
    offset = offsetMinutes(date, timeZone);
  } catch {
    // An invalid EVENT_TIMEZONE must not stop a check-in; fall back to UTC.
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const local = new Date(date.getTime() + offset * 60000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);

  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
