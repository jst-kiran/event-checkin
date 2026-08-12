/**
 * Single Source of Truth for Generated Teams.
 *
 * Active generated teams are stored in the `Teams` tab of the Google Sheet.
 * Reads are short-cache enabled (3s TTL) so concurrent lambdas across Vercel
 * access the exact same active team list without incurring excessive read quota.
 *
 * When an organizer generates teams, the `Teams` tab is overwritten with the
 * new draw, invalidating any previous draw.
 */

import { googleSheets, SHEET_NAMES, isMissingSheetError, columnLetter } from './googleSheets.js';
import { mapHeaders, cellFor, text } from './normalize.js';
import { formatTimestamp } from './time.js';

export const TEAMS_HEADERS = [
  'Timestamp',
  'Team Name',
  'Member Name',
  'Member Email',
  'Member Organization',
  'Team Size',
  'Ignored Members',
];

const CACHE_TTL_MS = 3000;
let cache = null;

export function teamsSheetName() {
  return process.env.SHEET_TEAMS || SHEET_NAMES?.teams || 'Teams';
}

/**
 * Saves generated teams into Google Sheets.
 * Overwrites existing rows in the `Teams` tab.
 */
export async function saveGeneratedTeams({
  teams = [],
  teamCount = 0,
  teamSize = 5,
  totalAttendees = 0,
  checkedInCount = 0,
  ignoredCount = 0,
  ignored = [],
  sheets = googleSheets,
  now = new Date(),
} = {}) {
  let existingRows;
  try {
    existingRows = await sheets.getSheetValues(teamsSheetName());
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;
    await sheets.ensureSheetExists(teamsSheetName());
    existingRows = [];
  }

  const timestamp = formatTimestamp(now);
  const ignoredText = (ignored || []).map((p) => p.name || p.email || p).join(', ');

  const newRows = [TEAMS_HEADERS];

  for (const team of teams) {
    for (const member of team.members) {
      newRows.push([
        timestamp,
        team.name,
        member.name || '',
        member.email || '',
        member.organization || '',
        String(teamSize),
        ignoredText,
      ]);
    }
  }

  // To cleanly overwrite the active team draw in the tab, we determine max range
  const lastCol = columnLetter(TEAMS_HEADERS.length - 1);
  const rowCount = Math.max(existingRows.length, newRows.length, 1);
  const endRange = `A1:${lastCol}${rowCount}`;

  // Pad matrix if previous draw was longer than current draw
  const paddedMatrix = [];
  for (let i = 0; i < rowCount; i++) {
    if (i < newRows.length) {
      paddedMatrix.push(newRows[i]);
    } else {
      paddedMatrix.push(new Array(TEAMS_HEADERS.length).fill(''));
    }
  }

  await sheets.updateSheetValues(teamsSheetName(), endRange, paddedMatrix);
  cache = null;

  return {
    teams,
    teamCount,
    teamSize,
    totalAttendees,
    checkedInCount,
    ignoredCount,
    ignored,
    timestamp,
    hasTeams: teams.length > 0,
  };
}

/**
 * Reads the active generated teams from Google Sheets.
 */
export async function getGeneratedTeams({ sheets = googleSheets, maxAgeMs = CACHE_TTL_MS } = {}) {
  if (cache && maxAgeMs > 0 && Date.now() - cache.at < maxAgeMs) {
    return cache.value;
  }

  let rows;
  try {
    rows = await sheets.getSheetValues(teamsSheetName());
  } catch (error) {
    if (!isMissingSheetError(error)) throw error;
    rows = [];
  }

  if (!rows || rows.length <= 1) {
    const emptyValue = {
      teams: [],
      teamCount: 0,
      teamSize: 0,
      totalAttendees: 0,
      checkedInCount: 0,
      ignoredCount: 0,
      ignored: [],
      hasTeams: false,
    };
    cache = { at: Date.now(), value: emptyValue };
    return emptyValue;
  }

  const map = mapHeaders(rows[0].map(text));
  const teamsMap = new Map();
  let ignoredText = '';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const teamName = cellFor(row, map, 'teamName');
    const memberName = cellFor(row, map, 'memberName');
    const memberEmail = cellFor(row, map, 'memberEmail');
    const organization = cellFor(row, map, 'memberOrganization');

    if (!teamName) continue;

    if (!teamsMap.has(teamName)) {
      teamsMap.set(teamName, []);
    }

    if (memberName || memberEmail) {
      teamsMap.get(teamName).push({
        name: memberName || memberEmail,
        email: memberEmail || '',
        organization: organization || '',
      });
    }

    const rowIgnored = cellFor(row, map, 'ignoredMembers');
    if (rowIgnored && !ignoredText) ignoredText = rowIgnored;
  }

  const teams = [...teamsMap.entries()].map(([name, members]) => ({ name, members }));

  const ignored = ignoredText
    ? ignoredText.split(',').map((s) => ({ name: s.trim() })).filter((p) => p.name)
    : [];

  const totalAttendees = teams.reduce((acc, t) => acc + t.members.length, 0);

  const value = {
    teams,
    teamCount: teams.length,
    teamSize: teams.length ? teams[0].members.length : 0,
    totalAttendees,
    checkedInCount: totalAttendees,
    ignoredCount: ignored.length,
    ignored,
    hasTeams: teams.length > 0,
  };

  cache = { at: Date.now(), value };
  return value;
}

/**
 * Returns canonical team names currently generated.
 */
export async function getGeneratedTeamNames({ sheets = googleSheets } = {}) {
  const data = await getGeneratedTeams({ sheets });
  return data.teams.map((t) => t.name);
}

/**
 * Normalizes and checks if a team name is in the active generated teams list.
 * Returns the matching canonical team name or null.
 */
export async function isGeneratedTeamName(rawName, { sheets = googleSheets } = {}) {
  const clean = text(rawName).trim().replace(/\s+/g, ' ').toLowerCase();
  if (!clean) return null;

  const activeNames = await getGeneratedTeamNames({ sheets });
  return (
    activeNames.find((name) => text(name).trim().replace(/\s+/g, ' ').toLowerCase() === clean) ||
    null
  );
}

export function __resetGeneratedTeamsCache() {
  cache = null;
}
