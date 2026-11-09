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
  'db:setTeamMemberLinkRoster',
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

  it('creates, lists, and allocates unit ids with onRoster default false', () => {
    const created = handlers.get('db:upsertTeamMember')!(event, {
      unitId: 1,
      callsign: 'Alpha',
      role: 'IC',
      isSelf: true,
    }) as { unitId: number; callsign: string; isSelf: boolean; onRoster: boolean };
    expect(created).toMatchObject({
      unitId: 1,
      callsign: 'Alpha',
      isSelf: true,
      onRoster: false,
    });

    const allocated = handlers.get('db:allocateTeamUnitId')!(event) as number;
    expect(allocated).toBe(2);

    const listed = handlers.get('db:listTeamMembers')!(event) as { unitId: number }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].unitId).toBe(1);
  });

  it('does not put a member on roster without selecting a device link', () => {
    handlers.get('db:upsertTeamMember')!(event, {
      unitId: 1,
      callsign: 'A',
      onRoster: true,
    });
    const listed = handlers.get('db:listTeamMembers')!(event) as { onRoster: boolean }[];
    expect(listed[0].onRoster).toBe(false);
  });

  it('drops legacy color column on ensure', () => {
    db.close();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    db.execScript(`
      CREATE TABLE team_members (
        unit_id INTEGER PRIMARY KEY CHECK (unit_id BETWEEN 1 AND 65535),
        callsign TEXT NOT NULL,
        role TEXT,
        color TEXT,
        is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
        on_roster INTEGER NOT NULL DEFAULT 0 CHECK (on_roster IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO team_members (unit_id, callsign, color, is_self, on_roster, created_at, updated_at)
        VALUES (1, 'Painted', '#FF0000', 0, 0, 1, 1);
    `);
    getDatabase.mockReturnValue(db);
    handlers.clear();
    registerTeamRosterIpcHandlers({ ipcMain, assertIpcSender, getDatabase });

    const cols = db.prepare('PRAGMA table_info(team_members)').all() as { name: string }[];
    expect(cols.some((c) => c.name === 'color')).toBe(false);
    const listed = handlers.get('db:listTeamMembers')!(event) as { callsign: string }[];
    expect(listed[0]?.callsign).toBe('Painted');
  });

  it('sets link onRoster and mirrors member onRoster; clearing last link clears member', () => {
    handlers.get('db:upsertTeamMember')!(event, {
      unitId: 1,
      callsign: 'A',
    });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '42',
    });
    const on = handlers.get('db:setTeamMemberLinkRoster')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '42',
      onRoster: true,
    }) as { onRoster: boolean; links: { onRoster: boolean }[] };
    expect(on.onRoster).toBe(true);
    expect(on.links[0]?.onRoster).toBe(true);

    const off = handlers.get('db:setTeamMemberLinkRoster')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '42',
      onRoster: false,
    }) as { onRoster: boolean; links: { onRoster: boolean }[] };
    expect(off.onRoster).toBe(false);
    expect(off.links[0]?.onRoster).toBe(false);
  });

  it('migrates member on_roster to all existing links', () => {
    db.close();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    db.execScript(`
      CREATE TABLE team_members (
        unit_id INTEGER PRIMARY KEY CHECK (unit_id BETWEEN 1 AND 65535),
        callsign TEXT NOT NULL,
        role TEXT,
        is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
        on_roster INTEGER NOT NULL DEFAULT 0 CHECK (on_roster IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE team_member_links (
        unit_id INTEGER NOT NULL REFERENCES team_members(unit_id) ON DELETE CASCADE,
        protocol TEXT NOT NULL CHECK (protocol IN ('meshtastic','meshcore','reticulum')),
        durable_key TEXT NOT NULL,
        node_id INTEGER,
        long_name TEXT,
        identity_id TEXT,
        PRIMARY KEY (unit_id, protocol, durable_key),
        UNIQUE (protocol, durable_key)
      );
      INSERT INTO team_members (unit_id, callsign, is_self, on_roster, created_at, updated_at)
        VALUES (1, 'Legacy', 0, 1, 1, 1);
      INSERT INTO team_member_links (unit_id, protocol, durable_key)
        VALUES (1, 'meshtastic', '7'), (1, 'meshcore', '8');
    `);
    getDatabase.mockReturnValue(db);
    handlers.clear();
    registerTeamRosterIpcHandlers({ ipcMain, assertIpcSender, getDatabase });

    const listed = handlers.get('db:listTeamMembers')!(event) as {
      onRoster: boolean;
      links: { durableKey: string; onRoster: boolean }[];
    }[];
    expect(listed[0].onRoster).toBe(true);
    expect(listed[0].links.every((l) => l.onRoster)).toBe(true);
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

  it('allows multiple links on the same protocol and rejects durableKey reuse', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:upsertTeamMember')!(event, { unitId: 2, callsign: 'B' });

    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '12345',
      nodeId: 12345,
      longName: 'Node A',
    });
    const linked = handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '67890',
      nodeId: 67890,
      longName: 'Node A2',
    }) as { links: { protocol: string; durableKey: string }[] };
    expect(linked.links).toHaveLength(2);
    expect(linked.links.map((l) => l.durableKey).sort()).toEqual(['12345', '67890']);

    expect(() =>
      handlers.get('db:setTeamMemberLink')!(event, {
        unitId: 2,
        protocol: 'meshtastic',
        durableKey: '12345',
        nodeId: 12345,
      }),
    ).toThrow(/durableKey already linked/);
  });

  it('updates metadata for an existing durable key without replacing siblings', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'reticulum',
      durableKey: 'a'.repeat(32),
    });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'reticulum',
      durableKey: 'b'.repeat(32),
      longName: 'Peer B',
    });
    const updated = handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'reticulum',
      durableKey: 'b'.repeat(32),
      longName: 'Peer B renamed',
    }) as { links: { durableKey: string; longName: string | null }[] };
    expect(updated.links).toHaveLength(2);
    expect(updated.links.find((l) => l.durableKey === 'b'.repeat(32))?.longName).toBe(
      'Peer B renamed',
    );
  });

  it('removes a single link by durable key and deletes members with cascade', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshcore',
      durableKey: 'ab'.repeat(32),
      nodeId: 9,
    });
    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshcore',
      durableKey: 'cd'.repeat(32),
    });
    const unlinked = handlers.get('db:removeTeamMemberLink')!(
      event,
      1,
      'meshcore',
      'ab'.repeat(32),
    ) as { links: { durableKey: string }[] };
    expect(unlinked.links).toEqual([expect.objectContaining({ durableKey: 'cd'.repeat(32) })]);

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

  it('rejects invalid meshcore durable keys but accepts node-id fallback', () => {
    handlers.get('db:upsertTeamMember')!(event, { unitId: 1, callsign: 'A' });
    expect(() =>
      handlers.get('db:setTeamMemberLink')!(event, {
        unitId: 1,
        protocol: 'meshcore',
        durableKey: 'short',
      }),
    ).toThrow(/durableKey/);

    const linked = handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshcore',
      durableKey: '4242',
      nodeId: 4242,
    }) as { links: { durableKey: string }[] };
    expect(linked.links[0]?.durableKey).toBe('4242');
  });

  it('migrates legacy one-link-per-protocol PK and adds on_roster', () => {
    db.close();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    db.execScript(`
      CREATE TABLE team_members (
        unit_id INTEGER PRIMARY KEY CHECK (unit_id BETWEEN 1 AND 65535),
        callsign TEXT NOT NULL,
        role TEXT,
        is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE team_member_links (
        unit_id INTEGER NOT NULL REFERENCES team_members(unit_id) ON DELETE CASCADE,
        protocol TEXT NOT NULL CHECK (protocol IN ('meshtastic','meshcore','reticulum')),
        durable_key TEXT NOT NULL,
        node_id INTEGER,
        long_name TEXT,
        identity_id TEXT,
        PRIMARY KEY (unit_id, protocol),
        UNIQUE (protocol, durable_key)
      );
      INSERT INTO team_members (unit_id, callsign, is_self, created_at, updated_at)
        VALUES (1, 'Legacy', 0, 1, 1);
      INSERT INTO team_member_links (unit_id, protocol, durable_key)
        VALUES (1, 'meshtastic', '42');
    `);
    getDatabase.mockReturnValue(db);
    handlers.clear();
    registerTeamRosterIpcHandlers({ ipcMain, assertIpcSender, getDatabase });

    const listed = handlers.get('db:listTeamMembers')!(event) as {
      onRoster: boolean;
      links: unknown[];
    }[];
    expect(listed[0].onRoster).toBe(false);
    expect(listed[0].links).toHaveLength(1);

    handlers.get('db:setTeamMemberLink')!(event, {
      unitId: 1,
      protocol: 'meshtastic',
      durableKey: '99',
    });
    const after = handlers.get('db:listTeamMembers')!(event) as { links: unknown[] }[];
    expect(after[0].links).toHaveLength(2);
  });

  it('PK rebuild derives link on_roster from member and retries after stale _new table', () => {
    db.close();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    db.execScript(`
      CREATE TABLE team_members (
        unit_id INTEGER PRIMARY KEY CHECK (unit_id BETWEEN 1 AND 65535),
        callsign TEXT NOT NULL,
        role TEXT,
        is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
        on_roster INTEGER NOT NULL DEFAULT 0 CHECK (on_roster IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE team_member_links (
        unit_id INTEGER NOT NULL REFERENCES team_members(unit_id) ON DELETE CASCADE,
        protocol TEXT NOT NULL CHECK (protocol IN ('meshtastic','meshcore','reticulum')),
        durable_key TEXT NOT NULL,
        node_id INTEGER,
        long_name TEXT,
        identity_id TEXT,
        PRIMARY KEY (unit_id, protocol),
        UNIQUE (protocol, durable_key)
      );
      CREATE TABLE team_member_links_new (unit_id INTEGER);
      INSERT INTO team_members (unit_id, callsign, is_self, on_roster, created_at, updated_at)
        VALUES (1, 'LegacyOn', 0, 1, 1, 1);
      INSERT INTO team_member_links (unit_id, protocol, durable_key)
        VALUES (1, 'meshtastic', '42');
    `);
    getDatabase.mockReturnValue(db);
    handlers.clear();
    registerTeamRosterIpcHandlers({ ipcMain, assertIpcSender, getDatabase });

    const listed = handlers.get('db:listTeamMembers')!(event) as {
      onRoster: boolean;
      links: { onRoster: boolean }[];
    }[];
    expect(listed[0].onRoster).toBe(true);
    expect(listed[0].links[0]?.onRoster).toBe(true);
  });
});
