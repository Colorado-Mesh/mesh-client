import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const { handlers, getDatabase, assertIpcSender } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  getDatabase: vi.fn(),
  assertIpcSender: vi.fn(),
}));

import { NodeSqliteDB } from '../db-compat';
import { runSchemaUpgrade } from '../db-schema-sync';
import { registerTeamRosterIpcHandlers } from './team-roster-handlers';

const event = {} as IpcMainInvokeEvent;
const ipcMain = {
  handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
};

const CHANNELS = [
  'db:listTeamMembers',
  'db:allocateTeamUnitId',
  'db:upsertTeamMember',
  'db:deleteTeamMember',
  'db:setTeamMemberLink',
  'db:removeTeamMemberLink',
  'db:clearTeamMembers',
] as const;

describe('team roster IPC boundary', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    vi.clearAllMocks();
    assertIpcSender.mockReset();
    handlers.clear();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    getDatabase.mockReturnValue(db);
    registerTeamRosterIpcHandlers({ ipcMain, assertIpcSender, getDatabase });
  });

  afterEach(() => {
    db.close();
  });

  it.each([...CHANNELS])('rejects untrusted senders on %s', (channel) => {
    assertIpcSender.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    expect(() => handlers.get(channel)!(event, 1)).toThrow('untrusted sender');
    expect(assertIpcSender).toHaveBeenCalledWith(event, channel);
  });

  it('rejects invalid unitId', () => {
    expect(() => handlers.get('db:upsertTeamMember')!(event, { unitId: 0, callsign: 'A' })).toThrow(
      /unitId/,
    );
    expect(() =>
      handlers.get('db:upsertTeamMember')!(event, { unitId: 70000, callsign: 'A' }),
    ).toThrow(/unitId/);
  });

  it('creates, lists, and allocates unit ids', () => {
    const created = handlers.get('db:upsertTeamMember')!(event, {
      unitId: 1,
      callsign: 'Alpha',
      role: 'IC',
      isSelf: true,
    }) as { unitId: number; callsign: string; isSelf: boolean };
    expect(created).toMatchObject({ unitId: 1, callsign: 'Alpha', isSelf: true });

    const allocated = handlers.get('db:allocateTeamUnitId')!(event) as number;
    expect(allocated).toBe(2);

    const listed = handlers.get('db:listTeamMembers')!(event) as { unitId: number }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].unitId).toBe(1);
  });

  it('enforces a single isSelf member', () => {
    handlers.get('db:upsertTeamMember')!(event, {
      unitId: 1,
      callsign: 'A',
      isSelf: true,
    });
    handlers.get('db:upsertTeamMember')!(event, {
      unitId: 2,
      callsign: 'B',
      isSelf: true,
    });
    const listed = handlers.get('db:listTeamMembers')!(event) as {
      unitId: number;
      isSelf: boolean;
    }[];
    expect(listed.find((m) => m.unitId === 1)?.isSelf).toBe(false);
    expect(listed.find((m) => m.unitId === 2)?.isSelf).toBe(true);
  });

  it('links one node per protocol and rejects durableKey reuse', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:upsertTeamMember')!(event, { unitId: 2, callsign: 'B' });

    const linked = handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '12345',
      nodeId: 12345,
      longName: 'Node A',
    }) as { links: { protocol: string; durableKey: string }[] };
    expect(linked.links).toEqual([
      expect.objectContaining({ protocol: 'meshtastic', durableKey: '12345' }),
    ]);

    expect(() =>
      handlers.get('db:setTeamMemberLink')!(event, {
        unitId: 2,
        protocol: 'meshtastic',
        durableKey: '12345',
        nodeId: 12345,
      }),
    ).toThrow(/durableKey already linked/);
  });

  it('replaces the link for the same protocol on a member', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'reticulum',
      durableKey: 'a'.repeat(32),
    });
    const updated = handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'reticulum',
      durableKey: 'b'.repeat(32),
      longName: 'Peer B',
    }) as { links: { durableKey: string; longName: string | null }[] };
    expect(updated.links).toHaveLength(1);
    expect(updated.links[0].durableKey).toBe('b'.repeat(32));
    expect(updated.links[0].longName).toBe('Peer B');
  });

  it('removes links and deletes members with cascade', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshcore',
      durableKey: 'ab'.repeat(32),
      nodeId: 9,
    });
    const unlinked = handlers.get('db:removeTeamMemberLink')!(event, 1, 'meshcore') as {
      links: unknown[];
    };
    expect(unlinked.links).toEqual([]);

    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshcore',
      durableKey: 'cd'.repeat(32),
    });
    handlers.get('db:deleteTeamMember')!(event, 1);
    expect(handlers.get('db:listTeamMembers')!(event)).toEqual([]);
    const linkCount = (
      db.prepare('SELECT COUNT(*) as c FROM team_member_links').get() as { c: number }
    ).c;
    expect(linkCount).toBe(0);
  });

  it('clearTeamMembers empties both tables', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '1',
    });
    handlers.get('db:clearTeamMembers')!(event);
    expect(handlers.get('db:listTeamMembers')!(event)).toEqual([]);
  });

  it('rejects invalid meshcore durable keys', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    expect(() =>
      handlers.get('db:setTeamMemberLink')!(event, {
        unitId: 1,
        protocol: 'meshcore',
        durableKey: 'short',
      }),
    ).toThrow(/durableKey/);
  });
});
