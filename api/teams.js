/**
 * GET /api/teams
 *
 * Public attendee-facing endpoint for retrieving currently generated team names.
 * Used by /project-upload to populate the team selection dropdown.
 *
 * The dropdown should only offer a team once: `availableTeamNames` is
 * `teamNames` minus whichever teams have already submitted a project, per
 * api/_lib/projects.js. `submissionsClosed` reflects the admin-set deadline
 * in api/_lib/settings.js, so the form can close itself without attendees
 * needing to find out by trying.
 */

import { getGeneratedTeams } from './_lib/generatedTeams.js';
import { getSubmittedTeamNames } from './_lib/projects.js';
import { getProjectSubmissionDeadline, isProjectSubmissionClosed } from './_lib/settings.js';
import { send, requireMethod, fail, STATUS } from './_lib/responses.js';

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'GET')) return;

  try {
    const [data, submittedNames, submissionDeadline, submissionsClosed] = await Promise.all([
      getGeneratedTeams(),
      getSubmittedTeamNames(),
      getProjectSubmissionDeadline(),
      isProjectSubmissionClosed(),
    ]);

    const formattedTeams = data.teams.map((t) => ({
      name: t.name,
      members: (t.members || []).map((m) => m.name || m.email).filter(Boolean),
    }));
    const teamNames = formattedTeams.map((t) => t.name);

    const submitted = new Set(
      submittedNames.map((name) => name.trim().replace(/\s+/g, ' ').toLowerCase())
    );
    const availableTeamNames = teamNames.filter(
      (name) => !submitted.has(name.trim().replace(/\s+/g, ' ').toLowerCase())
    );

    return send(res, 200, {
      success: true,
      status: STATUS.OK,
      teams: formattedTeams,
      teamNames,
      availableTeamNames,
      hasTeams: teamNames.length > 0,
      teamCount: teamNames.length,
      submissionDeadline,
      submissionsClosed,
    });
  } catch (error) {
    return fail(res, error, 'api/teams');
  }
}
