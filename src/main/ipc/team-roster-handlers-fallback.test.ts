import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { TEAM_ROSTER_UNAVAILABLE_MESSAGE } from '../../shared/teamRosterUnavailable';
import {
  registerTeamRosterIpcFallbackHandlers,
  TEAM_ROSTER_IPC_CHANNELS,
} from './team-roster-handlers-fallback';

describe('team roster IPC fallback', () => {
  it('registers every team-roster channel and rejects with a stable unavailable error', () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const assertIpcSender = vi.fn();
    registerTeamRosterIpcFallbackHandlers({
      ipcMain: {
        handle(channel: string, fn) {
          handlers.set(channel, fn);
        },
      },
      assertIpcSender,
    });
    expect(handlers.size).toBe(TEAM_ROSTER_IPC_CHANNELS.length);
    const event = {} as IpcMainInvokeEvent;
    for (const channel of TEAM_ROSTER_IPC_CHANNELS) {
      const fn = handlers.get(channel);
      expect(fn).toBeTypeOf('function');
      expect(() => fn?.(event)).toThrow(TEAM_ROSTER_UNAVAILABLE_MESSAGE);
      expect(assertIpcSender).toHaveBeenCalledWith(event, channel);
    }
  });
});
