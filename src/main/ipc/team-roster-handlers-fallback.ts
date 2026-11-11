import type { IpcMain, IpcMainInvokeEvent } from 'electron';

/** Keep in sync with `TEAM_ROSTER_UNAVAILABLE_MESSAGE` in shared (not imported — sibling chunk). */
const TEAM_ROSTER_UNAVAILABLE_MESSAGE = 'Team roster unavailable';

export interface TeamRosterIpcFallbackDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
}

/** Channels registered by {@link registerTeamRosterIpcHandlers} (preload must stay in sync). */
export const TEAM_ROSTER_IPC_CHANNELS = [
  'db:listTeamMembers',
  'db:allocateTeamUnitId',
  'db:upsertTeamMember',
  'db:deleteTeamMember',
  'db:setTeamMemberLink',
  'db:setTeamMemberLinkRoster',
  'db:removeTeamMemberLink',
  'db:clearTeamMembers',
] as const;

/** Throws the stable error string surfaced to the renderer store. */
function teamRosterUnavailable(): never {
  throw new Error(TEAM_ROSTER_UNAVAILABLE_MESSAGE);
}

/**
 * Lightweight IPC stubs when `team-roster-handlers.js` fails to load.
 * Keeps preload calls from hanging or failing opaquely while staying out of the heavy bundle.
 */
export function registerTeamRosterIpcFallbackHandlers(deps: TeamRosterIpcFallbackDeps): void {
  const { ipcMain, assertIpcSender } = deps;
  for (const channel of TEAM_ROSTER_IPC_CHANNELS) {
    ipcMain.handle(channel, (event) => {
      assertIpcSender(event, channel);
      teamRosterUnavailable();
    });
  }
}
