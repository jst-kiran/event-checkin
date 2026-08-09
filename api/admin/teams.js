/**
 * GET /api/admin/teams?size=5&ignore=Name%20One,Name%20Two
 *
 * Randomly divides everyone who has checked in into teams of a given size.
 *
 * The organizer says how many people belong in a team; the number of teams is
 * arithmetic, not something anyone should be doing in their head at an event.
 *
 * The draw runs on the server against the live check-in list, not against
 * whatever the page last rendered, so a dashboard left open for an hour still
 * splits the people who are actually in the room.
 *
 * Nothing is persisted. Teams are derived data: pressing randomize again is
 * meant to produce a different, equally valid answer, and writing each draw
 * back to the sheet would turn a scratch tool into a source of truth nobody
 * asked for. The same goes for the ignore list — see below.
 */

import crypto from 'node:crypto';
import { requireAdmin } from '../_lib/auth.js';
import { getCheckedInRoster } from '../_lib/attendance.js';
import { pickTeamNames } from '../_lib/teamNames.js';
import { normalizeName } from '../_lib/normalize.js';
import { rateLimit, ADMIN_READ_LIMIT } from '../_lib/rateLimit.js';
import { send, requireMethod, getQuery, clientKey, fail, STATUS } from '../_lib/responses.js';

/** A team larger than this is a typo, not a plan. */
const MAX_TEAM_SIZE = 100;

/** Enough for a few organizers and hosts; beyond this the field is being misused. */
const MAX_IGNORED = 50;

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;
  if (!requireAdmin(req, res)) return;

  const limit = rateLimit(`teams:${clientKey(req)}`, ADMIN_READ_LIMIT);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { success: false, status: STATUS.RATE_LIMITED });
  }

  const query = getQuery(req);

  // parseInt is too forgiving here: it reads "1.5.2" as 1 and "3abc" as 3, so a
  // malformed value would silently become a plausible team size.
  const raw = typeof query.size === 'string' ? query.size.trim() : '';
  const teamSize = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > MAX_TEAM_SIZE) {
    return send(res, 400, {
      success: false,
      status: STATUS.INVALID_REQUEST,
      message: `Enter a whole number of members per team between 1 and ${MAX_TEAM_SIZE}.`,
    });
  }

  const requestedIgnores = parseIgnoreList(query.ignore);
  if (requestedIgnores.length > MAX_IGNORED) {
    return send(res, 400, {
      success: false,
      status: STATUS.INVALID_REQUEST,
      message: `You can exclude at most ${MAX_IGNORED} people from a draw.`,
    });
  }

  try {
    const roster = await getCheckedInRoster();
    const resolution = resolveIgnored(roster, requestedIgnores);

    // A typo must never silently produce a draw that includes somebody the
    // organizer meant to leave out — nor one that quietly excludes the wrong
    // person. Refuse, and say exactly what could not be resolved.
    if (resolution.unmatched.length || resolution.ambiguous.length) {
      return send(res, 400, {
        success: false,
        status: STATUS.INVALID_REQUEST,
        unmatched: resolution.unmatched,
        ambiguous: resolution.ambiguous,
      });
    }

    const eligible = roster.filter((person) => !resolution.excludedEmails.has(person.email));

    if (eligible.length === 0) {
      return send(res, 200, {
        success: true,
        status: STATUS.OK,
        teams: [],
        teamCount: 0,
        totalAttendees: 0,
        checkedInCount: roster.length,
        ignoredCount: resolution.excludedEmails.size,
      });
    }

    // Ceiling, so the remainder gets a team rather than being dropped: 43 people
    // at 5 per team is 9 teams, not 8 with 3 people left over.
    const teamCount = Math.ceil(eligible.length / teamSize);
    const members = distribute(shuffle(eligible), teamCount);
    const names = pickTeamNames(teamCount, (max) => crypto.randomInt(0, max));

    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      teams: members.map((people, index) => ({ name: names[index], members: people })),
      teamCount,
      teamSize,
      totalAttendees: eligible.length,
      checkedInCount: roster.length,
      ignoredCount: resolution.excludedEmails.size,
      ignored: resolution.excluded,
    });
  } catch (error) {
    return fail(res, error, 'api/admin/teams');
  }
}

/** "  Ann , Bob ,, " -> ["Ann", "Bob"] */
function parseIgnoreList(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, MAX_IGNORED + 1); // one over the cap, so the cap can be reported
}

/**
 * Matches typed names against the checked-in roster.
 *
 * Tolerant of case and stray whitespace, because these are typed by hand under
 * time pressure. Not tolerant of ambiguity: if two checked-in attendees share a
 * name, guessing which one the organizer meant would silently put the wrong
 * person in a team.
 *
 * The result is used for this draw and then forgotten. Nothing is written to
 * any sheet, no attendee's check-in status changes, and the next draw starts
 * from the full roster again.
 */
function resolveIgnored(roster, requestedNames) {
  const byName = new Map();
  for (const person of roster) {
    const key = normalizeName(person.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(person);
  }

  const excludedEmails = new Set();
  const excluded = [];
  const unmatched = [];
  const ambiguous = [];

  for (const typed of requestedNames) {
    const matches = byName.get(normalizeName(typed)) || [];

    if (matches.length === 0) {
      unmatched.push(typed);
    } else if (matches.length > 1) {
      // Enough detail for the organizer to tell the two apart and act.
      ambiguous.push({
        name: typed,
        candidates: matches.map((person) => ({
          name: person.name,
          email: person.email,
          organization: person.organization,
        })),
      });
    } else {
      const [person] = matches;
      if (!excludedEmails.has(person.email)) {
        excludedEmails.add(person.email);
        excluded.push({ name: person.name, email: person.email });
      }
    }
  }

  return { excludedEmails, excluded, unmatched, ambiguous };
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
 * Deals the shuffled list round-robin.
 *
 * Dealing rather than slicing gives two things at once: every attendee lands in
 * exactly one team by construction, and the shortfall is spread across the last
 * few teams instead of dumping it all on the final one. 43 people into 9 teams
 * becomes seven fives and two fours, never eight fives and a three.
 */
function distribute(list, teamCount) {
  const teams = Array.from({ length: teamCount }, () => []);
  list.forEach((person, index) => teams[index % teamCount].push(person));
  return teams;
}
