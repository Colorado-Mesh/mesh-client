import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import type { IncidentSnapshot } from '@/shared/incidentTypes';
import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

const KEY = 'mesh-client:incidents';
const PENDING_KEY = 'mesh-client:incidentPending';
const originalApi = window.electronAPI;

function report(text = 'MECP/0/M01 help') {
  return {
    parsed: tryParseMecp(text)!,
    protocol: 'meshtastic' as const,
    senderId: '!victim',
    receivedAt: Date.now(),
  };
}

async function legacyState(): Promise<IncidentSnapshot> {
  const { useIncidentStore } = await import('./incidentStore');
  useIncidentStore.getState().upsertFromMecp(report());
  localStorage.removeItem(PENDING_KEY);
  return JSON.parse(localStorage.getItem(KEY)!).state as IncidentSnapshot;
}

describe('incident SQLite hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(KEY);
    localStorage.removeItem(PENDING_KEY);
    vi.stubGlobal('electronAPI', { db: {} });
  });

  afterEach(() => {
    vi.stubGlobal('electronAPI', originalApi);
    vi.restoreAllMocks();
  });

  it('seeds the untouched legacy envelope and writes subsequent mutations through IPC', async () => {
    const original = await legacyState();
    const raw = localStorage.getItem(KEY);
    vi.resetModules();
    const seedIncidents = vi.fn().mockResolvedValue(original);
    const saveIncidents = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const { hydrateIncidentStore, useIncidentStore, flushIncidentPersistence } =
      await import('./incidentStore');
    await hydrateIncidentStore();
    expect(seedIncidents).toHaveBeenCalledExactlyOnceWith(raw);
    const id = Object.keys(original.incidents)[0];
    useIncidentStore.getState().recordAck(id, '!peer');
    await flushIncidentPersistence();
    expect(saveIncidents.mock.lastCall?.[0].incidents[id].ackPeerIds).toEqual(['!peer']);
    expect(localStorage.getItem(KEY)).toContain('!peer');
    await hydrateIncidentStore();
    expect(seedIncidents).toHaveBeenCalledTimes(1);
  });

  it.each(REGISTERED_MESH_PROTOCOLS)(
    'restores %s incidents from SQLite with empty localStorage',
    async (protocol) => {
      const state = await legacyState();
      const id = Object.keys(state.incidents)[0];
      state.incidents[id].protocol = protocol;
      state.incidents[id].protocolsSeen = [protocol];
      localStorage.removeItem(KEY);
      vi.resetModules();
      const seedIncidents = vi.fn().mockResolvedValue(state);
      vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents: vi.fn() } });
      const { hydrateIncidentStore, useIncidentStore } = await import('./incidentStore');
      await hydrateIncidentStore();
      expect(seedIncidents).toHaveBeenCalledWith(null);
      expect(useIncidentStore.getState().incidents).toEqual(state.incidents);
    },
  );

  it('replays live updates and clears over database hydration without losing database-only rows', async () => {
    const state = await legacyState();
    const id = Object.keys(state.incidents)[0];
    state.resolvedTombstones = { old: 10 };
    localStorage.removeItem(KEY);
    vi.resetModules();
    let resolve!: (value: IncidentSnapshot) => void;
    const seedIncidents = vi.fn(
      () =>
        new Promise<IncidentSnapshot>((done) => {
          resolve = done;
        }),
    );
    const saveIncidents = vi.fn();
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const { hydrateIncidentStore, useIncidentStore, flushIncidentPersistence } =
      await import('./incidentStore');
    const loading = hydrateIncidentStore();
    useIncidentStore.getState().upsertFromMecp({ ...report('MECP/1/T04 road'), senderId: '!live' });
    expect(saveIncidents).not.toHaveBeenCalled();
    resolve(state);
    await loading;
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(2);
    expect(useIncidentStore.getState().incidents[id]).toEqual(state.incidents[id]);
    useIncidentStore.getState().clearAll();
    await flushIncidentPersistence();
    expect(saveIncidents.mock.lastCall?.[0]).toEqual({
      incidents: {},
      resolvedTombstones: { old: 10 },
    });
  });

  it('honors database tombstones when replaying history seed received while hydration is pending', async () => {
    const state = await legacyState();
    const id = Object.keys(state.incidents)[0];
    const incoming = report();
    localStorage.removeItem(KEY);
    vi.resetModules();
    let resolve!: (value: IncidentSnapshot) => void;
    vi.stubGlobal('electronAPI', {
      db: {
        seedIncidents: () =>
          new Promise<IncidentSnapshot>((done) => {
            resolve = done;
          }),
        saveIncidents: vi.fn(),
      },
    });
    const { hydrateIncidentStore, useIncidentStore } = await import('./incidentStore');
    const loading = hydrateIncidentStore();
    useIncidentStore.getState().upsertFromMecp({ ...incoming, fromSeed: true });
    resolve({ incidents: {}, resolvedTombstones: { [id]: incoming.receivedAt } });
    await loading;
    expect(useIncidentStore.getState().incidents).toEqual({});
  });

  it('retains cached state on read failure and retries without overwriting canonical data', async () => {
    mockConsoleWarn();
    const state = await legacyState();
    const id = Object.keys(state.incidents)[0];
    vi.resetModules();
    const seedIncidents = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(state);
    const saveIncidents = vi.fn();
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const { hydrateIncidentStore, useIncidentStore, flushIncidentPersistence } =
      await import('./incidentStore');
    await hydrateIncidentStore();
    expect(useIncidentStore.getState().incidents).toEqual(state.incidents);
    expect(saveIncidents).not.toHaveBeenCalled();
    useIncidentStore.getState().recordAck(id, '!peer');
    await flushIncidentPersistence();
    expect(seedIncidents).toHaveBeenCalledTimes(2);
    expect(saveIncidents.mock.lastCall?.[0].incidents[id].ackPeerIds).toEqual(['!peer']);
  });

  it('serializes writes so a slow earlier snapshot cannot overwrite a later resolve', async () => {
    const state = await legacyState();
    const id = Object.keys(state.incidents)[0];
    vi.resetModules();
    let release!: () => void;
    const saveIncidents = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', {
      db: { seedIncidents: vi.fn().mockResolvedValue(state), saveIncidents },
    });
    const { hydrateIncidentStore, useIncidentStore, flushIncidentPersistence } =
      await import('./incidentStore');
    await hydrateIncidentStore();
    saveIncidents.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    useIncidentStore.getState().recordAck(id, '!peer');
    useIncidentStore.getState().resolveIncident(id, 5_000);
    await Promise.resolve();
    expect(saveIncidents.mock.lastCall?.[0].incidents[id].status).toBe('acked');
    release();
    await flushIncidentPersistence();
    expect(saveIncidents.mock.lastCall?.[0].incidents[id].status).toBe('resolved');
  });

  it('retries a failed write without dropping the updated recovery cache', async () => {
    mockConsoleWarn();
    const state = await legacyState();
    const id = Object.keys(state.incidents)[0];
    vi.resetModules();
    const saveIncidents = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', {
      db: { seedIncidents: vi.fn().mockResolvedValue(state), saveIncidents },
    });
    const { hydrateIncidentStore, useIncidentStore, flushIncidentPersistence } =
      await import('./incidentStore');
    await hydrateIncidentStore();
    saveIncidents.mockRejectedValueOnce(new Error('disk full'));
    useIncidentStore.getState().resolveIncident(id, 5_000);
    await flushIncidentPersistence();
    expect(localStorage.getItem(PENDING_KEY)).toBeTruthy();
    await flushIncidentPersistence();
    expect(saveIncidents.mock.lastCall?.[0].incidents[id].status).toBe('resolved');
    expect(JSON.parse(localStorage.getItem(KEY)!).state.incidents[id].status).toBe('resolved');
    expect(saveIncidents).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite an unreadable legacy cache when the database import also fails', async () => {
    mockConsoleWarn();
    localStorage.setItem(KEY, '{invalid');
    vi.stubGlobal('electronAPI', {
      db: {
        seedIncidents: vi.fn().mockRejectedValue(new Error('invalid import')),
        saveIncidents: vi.fn(),
      },
    });
    const { hydrateIncidentStore, useIncidentStore } = await import('./incidentStore');
    useIncidentStore.getState().upsertFromMecp(report());
    await hydrateIncidentStore();
    expect(localStorage.getItem(KEY)).toBe('{invalid');
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(1);
  });

  it('recovers an incident after a failed write and process restart', async () => {
    mockConsoleWarn();
    let durable: IncidentSnapshot = { incidents: {}, resolvedTombstones: {} };
    const seedIncidents = vi.fn(() =>
      Promise.resolve(JSON.parse(JSON.stringify(durable)) as IncidentSnapshot),
    );
    const saveIncidents = vi.fn().mockRejectedValue(new Error('SQLITE_FULL'));
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const first = await import('./incidentStore');
    await first.hydrateIncidentStore();
    const id = first.useIncidentStore.getState().upsertFromMecp(report())!;
    await first.flushIncidentPersistence();
    expect(localStorage.getItem(PENDING_KEY)).toBeTruthy();
    expect(durable.incidents).toEqual({});
    vi.resetModules();
    saveIncidents.mockImplementation((value: IncidentSnapshot) => {
      durable = value;
      return Promise.resolve();
    });
    const second = await import('./incidentStore');
    await second.hydrateIncidentStore();
    expect(second.useIncidentStore.getState().incidents[id]).toBeDefined();
    expect(durable.incidents[id]).toBeDefined();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('replays a failed resolution over newer database fields and preserves database-only rows', async () => {
    mockConsoleWarn();
    let durable = await legacyState();
    const id = Object.keys(durable.incidents)[0];
    vi.resetModules();
    const seedIncidents = vi.fn(() =>
      Promise.resolve(JSON.parse(JSON.stringify(durable)) as IncidentSnapshot),
    );
    const saveIncidents = vi.fn().mockRejectedValue(new Error('SQLITE_FULL'));
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const first = await import('./incidentStore');
    await first.hydrateIncidentStore();
    first.useIncidentStore.getState().resolveIncident(id, 5_000);
    await first.flushIncidentPersistence();
    durable.incidents[id].senderName = 'Updated from another origin';
    durable.incidents[id].ackPeerIds = ['!durable-peer'];
    durable.incidents[id].ackCount = 1;
    durable.incidents[id].events!.push({ at: 4_000, kind: 'ackHeard', peerId: '!durable-peer' });
    durable.incidents.other = { ...durable.incidents[id], id: 'other' };
    durable.resolvedTombstones.otherResolved = 9_000;
    vi.resetModules();
    saveIncidents.mockImplementation((value: IncidentSnapshot) => {
      durable = value;
      return Promise.resolve();
    });
    const second = await import('./incidentStore');
    await second.hydrateIncidentStore();
    expect(durable.incidents[id]).toMatchObject({
      status: 'resolved',
      resolvedAt: 5_000,
      senderName: 'Updated from another origin',
      ackPeerIds: ['!durable-peer'],
      ackCount: 1,
    });
    expect(durable.incidents[id].events).toEqual(
      expect.arrayContaining([
        { at: 4_000, kind: 'ackHeard', peerId: '!durable-peer' },
        { at: 5_000, kind: 'resolved' },
      ]),
    );
    expect(durable.incidents.other).toBeDefined();
    expect(durable.resolvedTombstones).toMatchObject({ [id]: 5_000, otherResolved: 9_000 });
  });

  it('replays clearAll after restart without resurrecting rows or deleting database-only records', async () => {
    mockConsoleWarn();
    let durable = await legacyState();
    const id = Object.keys(durable.incidents)[0];
    durable.resolvedTombstones.previous = 1;
    vi.resetModules();
    const seedIncidents = vi.fn(() =>
      Promise.resolve(JSON.parse(JSON.stringify(durable)) as IncidentSnapshot),
    );
    const saveIncidents = vi.fn().mockRejectedValue(new Error('SQLITE_FULL'));
    vi.stubGlobal('electronAPI', { db: { seedIncidents, saveIncidents } });
    const first = await import('./incidentStore');
    await first.hydrateIncidentStore();
    first.useIncidentStore.getState().clearAll();
    await first.flushIncidentPersistence();
    durable.incidents.other = { ...durable.incidents[id], id: 'other' };
    vi.resetModules();
    saveIncidents.mockImplementation((value: IncidentSnapshot) => {
      durable = value;
      return Promise.resolve();
    });
    const second = await import('./incidentStore');
    await second.hydrateIncidentStore();
    expect(durable.incidents[id]).toBeUndefined();
    expect(durable.incidents.other).toBeDefined();
    expect(durable.resolvedTombstones.previous).toBe(1);
  });
});
