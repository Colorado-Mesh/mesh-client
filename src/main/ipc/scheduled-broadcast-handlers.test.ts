import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const { handlers, getDatabase, assertIpcSender } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  getDatabase: vi.fn(),
  assertIpcSender: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}));
vi.mock('../database', () => ({ getDatabase }));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender }));

import { NodeSqliteDB } from '../db-compat';
import { runSchemaUpgrade } from '../db-schema-sync';
import { registerScheduledBroadcastIpcHandlers } from './scheduled-broadcast-handlers';

const event = {} as IpcMainInvokeEvent;

const CHANNELS = [
  'db:listScheduledBroadcasts',
  'db:saveScheduledBroadcast',
  'db:deleteScheduledBroadcast',
  'db:clearScheduledBroadcasts',
  'db:claimScheduledBroadcastDue',
  'db:setScheduledBroadcastResult',
] as const;

describe('scheduled broadcast IPC boundary', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    vi.clearAllMocks();
    assertIpcSender.mockReset();
    handlers.clear();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    getDatabase.mockReturnValue(db);
    registerScheduledBroadcastIpcHandlers();
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

  it('rejects slot 0 and 13', () => {
    expect(() => handlers.get('db:saveScheduledBroadcast')!(event, { slot: 0 })).toThrow(/slot/);
    expect(() => handlers.get('db:saveScheduledBroadcast')!(event, { slot: 13 })).toThrow(/slot/);
  });

  it('rejects non-integer slot', () => {
    expect(() => handlers.get('db:saveScheduledBroadcast')!(event, { slot: 1.5 })).toThrow(/slot/);
  });

  it('rejects oversized text', () => {
    expect(() =>
      handlers.get('db:saveScheduledBroadcast')!(event, {
        slot: 1,
        text: 'x'.repeat(2001),
      }),
    ).toThrow(/text/);
  });

  it('rejects unknown interval', () => {
    expect(() =>
      handlers.get('db:saveScheduledBroadcast')!(event, {
        slot: 1,
        interval: 'yearly',
      }),
    ).toThrow(/interval/);
  });

  it('rejects bad channel index', () => {
    expect(() =>
      handlers.get('db:saveScheduledBroadcast')!(event, {
        slot: 1,
        targets: [
          {
            kind: 'meshtastic-channel',
            identityId: 'id1',
            label: 'Ch0',
            enabled: true,
            channelIndex: -1,
          },
        ],
      }),
    ).toThrow(/channelIndex/);
  });

  it('CRUD round-trip upserts and updates updated_at', async () => {
    const save = handlers.get('db:saveScheduledBroadcast')!;
    const first = save(event, {
      slot: 2,
      label: 'Morning',
      text: 'hello',
      enabled: true,
      interval: 'daily',
      timeOfDayMin: 540,
      targets: [
        {
          kind: 'meshcore-channel',
          identityId: 'mc1',
          label: 'Public',
          enabled: true,
          channelIndex: 0,
        },
      ],
    }) as { slot: number; updatedAt: number; text: string };
    expect(first.slot).toBe(2);
    expect(first.text).toBe('hello');
    const listed = handlers.get('db:listScheduledBroadcasts')!(event) as { slot: number }[];
    expect(listed).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 2));
    const second = save(event, { slot: 2, text: 'world' }) as {
      text: string;
      updatedAt: number;
      label: string;
    };
    expect(second.text).toBe('world');
    expect(second.label).toBe('Morning');
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('claimAnnouncementDue: first claim wins, second loses, stale expected loses', () => {
    const save = handlers.get('db:saveScheduledBroadcast')!;
    const claim = handlers.get('db:claimScheduledBroadcastDue')!;
    const due = Date.now() + 60_000;
    const next = due + 86_400_000;
    save(event, { slot: 1, enabled: true, nextDueAt: due });

    expect(claim(event, 1, due, next, Date.now())).toEqual({ claimed: true });
    expect(claim(event, 1, due, next + 1, Date.now())).toEqual({ claimed: false });
    expect(claim(event, 1, due - 1, next + 2, Date.now())).toEqual({ claimed: false });
  });

  it('clearScheduledBroadcasts empties the table', () => {
    handlers.get('db:saveScheduledBroadcast')!(event, { slot: 1, text: 'a' });
    handlers.get('db:saveScheduledBroadcast')!(event, { slot: 3, text: 'b' });
    handlers.get('db:clearScheduledBroadcasts')!(event);
    expect(handlers.get('db:listScheduledBroadcasts')!(event)).toEqual([]);
  });

  it('setScheduledBroadcastResult persists last result', () => {
    handlers.get('db:saveScheduledBroadcast')!(event, { slot: 1, text: 'a' });
    const at = Date.now();
    handlers.get('db:setScheduledBroadcastResult')!(event, 1, at, {
      at,
      outcome: 'sent',
      targets: [{ kind: 'meshtastic-channel', label: 'Ch0', ok: true }],
    });
    const rows = handlers.get('db:listScheduledBroadcasts')!(event) as {
      lastResult: { outcome: string } | null;
      lastAttemptAt: number | null;
    }[];
    expect(rows[0]?.lastAttemptAt).toBe(at);
    expect(rows[0]?.lastResult?.outcome).toBe('sent');
  });

  it('creates scheduled_broadcasts table via schema sync', () => {
    const cols = db.prepareOnce(`PRAGMA table_info(scheduled_broadcasts)`).all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'slot',
        'label',
        'text',
        'enabled',
        'interval',
        'time_of_day_min',
        'targets_json',
        'updated_at',
      ]),
    );
    // Idempotent second sync
    runSchemaUpgrade(db);
    expect(
      (db.prepareOnce(`PRAGMA table_info(scheduled_broadcasts)`).all() as { name: string }[])
        .length,
    ).toBe(cols.length);
  });
});
