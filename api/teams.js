/**
 * GET /api/teams
 *
 * Public attendee-facing endpoint for retrieving currently generated team names.
 * Used by /project-upload to populate the team selection dropdown.
 */

import { getGeneratedTeams } from './_lib/generatedTeams.js';
import { send, requireMethod, fail, STATUS } from './_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;

  try {
    const data = await getGeneratedTeams();
    const formattedTeams = data.teams.map((t) => ({
      name: t.name,
      members: (t.members || []).map((m) => m.name || m.email).filter(Boolean),
    }));
    const teamNames = formattedTeams.map((t) => t.name);

    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      teams: formattedTeams,
      teamNames,
      hasTeams: teamNames.length > 0,
      teamCount: teamNames.length,
    });
  } catch (error) {
    return fail(res, error, 'api/teams');
  }
}
