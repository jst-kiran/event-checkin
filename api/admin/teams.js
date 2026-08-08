/**
 * GET /api/admin/teams?teams=5
 *
 * Randomly divides everyone who has checked in.
 *
 * The draw runs on the server against the live check-in list, not against
 * whatever the page last rendered, so a dashboard left open for an hour still
 * splits the people who are actually in the room.
 *
 * Nothing is persisted. Teams are derived data: pressing randomize again is
 * meant to produce a different, equally valid answer, and writing each draw
 * back to the sheet would turn a scratch tool into a source of truth nobody
 * asked for.
 */

import crypto from 'node:crypto';
import { requireAdmin } from '../_lib/auth.js';
import { getCheckedInRoster } from '../_lib/attendance.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, getQuery, clientKey, fail, STATUS } from '../_lib/responses.js';

/** A draw beyond this is a typo, not a plan. */
const MAX_TEAMS = 100;

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`teams:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  const query = getQuery(req);

  // parseInt is too forgiving here: it reads "1.5.2" as 1 and "3abc" as 3, so
  // a malformed value would silently become a plausible team count. Require
  // the whole string to be digits before converting.
  const raw = typeof query.teams === 'string' ? query.teams.trim() : '';
  const requested = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_TEAMS) {
    return send(res, 400, {
      success: false,
      status: STATUS.INVALID_REQUEST,
      message: `Enter a whole number of teams between 1 and ${MAX_TEAMS}.`,
    });
  }

  try {
    const roster = await getCheckedInRoster();

    if (roster.length === 0) {
      return send(res, 200, {
        success: true,
        status: STATUS.OK,
        teams: [],
        teamCount: 0,
        totalAttendees: 0,
      });
    }

    // Fewer people than teams would otherwise produce a run of empty teams;
    // one team per person is the useful answer instead.
    const teamCount = Math.min(requested, roster.length);
    const teams = distribute(shuffle(roster), teamCount);

    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      teams,
      teamCount: teams.length,
      totalAttendees: roster.length,
    });
  } catch (error) {
    return fail(res, error, 'api/admin/teams');
  }
}

/**
 * Fisher-Yates over a CSPRNG.
 *
 * Math.random() would be good enough for a party game, but crypto.randomInt is
 * free here and removes any argument about the draw being predictable or
 * biased — every permutation is equally likely.
 */
function shuffle(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Deals the shuffled list round-robin, so team sizes differ by at most one
 * when the division is uneven: 10 people into 3 teams gives 4/3/3.
 *
 * Dealing rather than slicing also means every attendee lands in exactly one
 * team by construction — there is no index arithmetic that could drop or
 * duplicate somebody.
 */
function distribute(list, teamCount) {
  const teams = Array.from({ length: teamCount }, () => []);
  list.forEach((person, index) => teams[index % teamCount].push(person));
  return teams;
}
