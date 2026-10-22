import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncidentSnapshot } from '../../shared/incidentTypes';

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
import { registerIncidentIpcHandlers } from './incident-handlers';

const event = {} as IpcMainInvokeEvent;

describe('incident IPC boundary', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    vi.clearAllMocks();
    assertIpcSender.mockReset();
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    getDatabase.mockReturnValue(db);
    registerIncidentIpcHandlers();
  });

  afterEach(() => {
    db.close();
  });

  it.each(['db:getIncidents', 'db:saveIncidents', 'db:seedIncidents'])(
    'rejects untrusted senders before touching the database on %s',
    (channel) => {
      assertIpcSender.mockImplementation(() => {
        throw new Error('untrusted sender');
      });
      expect(() => handlers.get(channel)!(event, null)).toThrow('untrusted sender');
      expect(assertIpcSender).toHaveBeenCalledWith(event, channel);
      expect(getDatabase).not.toHaveBeenCalled();
    },
  );

  it('round-trips durable state through registered handlers', () => {
    const state: IncidentSnapshot = { incidents: {}, resolvedTombstones: { resolved: 7 } };
    expect(handlers.get('db:seedIncidents')!(event, JSON.stringify({ state, version: 3 }))).toEqual(
      state,
    );
    const updated = { incidents: {}, resolvedTombstones: { resolved: 9 } };
    expect(handlers.get('db:saveIncidents')!(event, updated)).toBeUndefined();
    expect(handlers.get('db:getIncidents')!(event)).toEqual(updated);
    expect(handlers.get('db:seedIncidents')!(event, null)).toEqual(updated);
  });

  it('propagates invalid mutation data without replacing stored state', () => {
    const state = { incidents: {}, resolvedTombstones: { resolved: 7 } };
    handlers.get('db:saveIncidents')!(event, state);
    expect(() => handlers.get('db:saveIncidents')!(event, { incidents: { bad: {} } })).toThrow();
    expect(handlers.get('db:getIncidents')!(event)).toEqual(state);
  });

  it('propagates legacy import failure so migration cannot report success', () => {
    expect(() => handlers.get('db:seedIncidents')!(event, '{')).toThrow();
    expect(db.prepare('SELECT * FROM emergency_incident_storage').all()).toEqual([]);
  });

  it.each(['db:getIncidents', 'db:saveIncidents', 'db:seedIncidents'])(
    'propagates database unavailability on %s',
    (channel) => {
      getDatabase.mockImplementationOnce(() => {
        throw new Error('database unavailable');
      });
      expect(() => handlers.get(channel)!(event, null)).toThrow('database unavailable');
    },
  );
});
