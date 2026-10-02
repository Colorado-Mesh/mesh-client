// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db-ipc-lifecycle', () => ({
  getDbForIpc: vi.fn(() => null),
  finishDbIpcHandler: vi.fn((_channel: string, err: unknown) => {
    throw err;
  }),
  finishDbIpcReadHandler: vi.fn((_channel: string, err: unknown) => {
    throw err;
  }),
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { MS_PER_DAY } from '../../shared/timeConstants';
import { NodeSqliteDB } from '../db-compat';
import { getDbForIpc } from '../db-ipc-lifecycle';
import { runSchemaUpgrade } from '../db-schema-sync';
import { pruneEnvironmentTelemetryOn } from '../environment-telemetry-db';
import { registerEnvironmentTelemetryIpcHandlers } from './environment-telemetry-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const getDbForIpcMock = vi.mocked(getDbForIpc);

describe('environment-telemetry-handlers', { timeout: 30_000 }, () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;
  let db: NodeSqliteDB;

  const call = (channel: string, ...args: unknown[]) => {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`missing handler ${channel}`);
    return fn(event, ...args);
  };

  beforeAll(() => {
    registerEnvironmentTelemetryIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    getDbForIpcMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('registers the expected channels', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'db:clearEnvironmentTelemetry',
      'db:getEnvironmentTelemetry',
      'db:pruneEnvironmentTelemetry',
      'db:saveEnvironmentTelemetry',
    ]);
  });

  it('saves a sanitized reading and reads it back', () => {
    const now = Date.now();
    expect(
      call(
        'db:saveEnvironmentTelemetry',
        'meshtastic',
        1234,
        now,
        { temperature: 21.5, relativeHumidity: 40, bogus: 'x', lux: Number.NaN },
        'mqtt',
      ),
    ).toEqual({ changes: 1 });
    const rows = call('db:getEnvironmentTelemetry', now - 1000) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      protocol: 'meshtastic',
      node_id: 1234,
      recorded_at: now,
      source: 'mqtt',
      temperature: 21.5,
      relative_humidity: 40,
      lux: null,
    });
  });

  it.each([
    ['unknown protocol', ['bogus', 1, Date.now(), { temperature: 1 }, 'rf']],
    ['invalid node id', ['meshtastic', -1, Date.now(), { temperature: 1 }, 'rf']],
    ['empty reading', ['meshtastic', 1, Date.now(), { temperature: 'hot' }, 'rf']],
    ['invalid source', ['meshtastic', 1, Date.now(), { temperature: 1 }, 'satellite']],
    ['non-finite time', ['meshtastic', 1, Number.POSITIVE_INFINITY, { temperature: 1 }, 'rf']],
  ])('rejects %s without writing', (_label, args) => {
    expect(call('db:saveEnvironmentTelemetry', ...args)).toEqual({ changes: 0 });
    expect(call('db:getEnvironmentTelemetry', 0)).toEqual([]);
  });

  it('returns empty results while the database is closed', () => {
    getDbForIpcMock.mockReturnValue(null);
    expect(
      call('db:saveEnvironmentTelemetry', 'meshtastic', 1, Date.now(), { temperature: 1 }, 'rf'),
    ).toEqual({ changes: 0 });
    expect(call('db:getEnvironmentTelemetry', 0)).toEqual([]);
    expect(call('db:pruneEnvironmentTelemetry')).toBe(0);
  });

  it('clears all rows', () => {
    call('db:saveEnvironmentTelemetry', 'meshcore', 9, Date.now(), { temperature: 1 }, 'rpc');
    expect(call('db:clearEnvironmentTelemetry')).toEqual({ changes: 1 });
    expect(call('db:getEnvironmentTelemetry', 0)).toEqual([]);
  });

  it('prunes by age and caps rows per protocol and node', () => {
    const now = Date.now();
    call('db:saveEnvironmentTelemetry', 'meshtastic', 1, now - 10 * MS_PER_DAY, { co2: 1 }, 'rf');
    for (let i = 0; i < 5; i++) {
      call('db:saveEnvironmentTelemetry', 'meshtastic', 2, now - i * 1000, { co2: i }, 'rf');
    }
    // Same node id under another protocol is capped independently.
    call('db:saveEnvironmentTelemetry', 'meshcore', 2, now, { co2: 99 }, 'rpc');

    expect(pruneEnvironmentTelemetryOn(db, 7 * MS_PER_DAY, 3)).toBe(3);
    const rows = call('db:getEnvironmentTelemetry', 0) as { protocol: string; co2: number }[];
    expect(rows.filter((r) => r.protocol === 'meshtastic').map((r) => r.co2)).toEqual([2, 1, 0]);
    expect(rows.filter((r) => r.protocol === 'meshcore')).toHaveLength(1);
  });
});
