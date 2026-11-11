/** Stable main-process error when the team-roster handler bundle failed to load. */
export const TEAM_ROSTER_UNAVAILABLE_MESSAGE = 'Team roster unavailable';

export function isTeamRosterUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes(TEAM_ROSTER_UNAVAILABLE_MESSAGE);
}
