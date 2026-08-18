import { describe, expect, it } from 'vitest';

import type { MeshCoreRepeaterStatus } from './meshcore/meshcoreHookTypes';
import type { PathRecord } from './pathHistoryTypes';
import {
  DEFAULT_REPEATER_SORT,
  defaultRepeaterSortDir,
  nextRepeaterSort,
  prepareRepeaterSortRows,
  resolveRepeaterRssi,
  resolveRepeaterSnr,
  sortPreparedRepeaterRows,
} from './repeaterListSort';
import type { MeshNode } from './types';

function mockStatus(partial: Partial<MeshCoreRepeaterStatus>): MeshCoreRepeaterStatus {
  return {
    battMilliVolts: 0,
    noiseFloor: 0,
    lastRssi: 0,
    lastSnr: 0,
    nPacketsRecv: 0,
    nPacketsSent: 0,
    totalAirTimeSecs: 0,
    totalUpTimeSecs: 0,
    nSentFlood: 0,
    nSentDirect: 0,
    nRecvFlood: 0,
    nRecvDirect: 0,
    errEvents: 0,
    nDirectDups: 0,
    nFloodDups: 0,
    currTxQueueLen: 0,
    ...partial,
  };
}

function node(partial: Partial<MeshNode> & Pick<MeshNode, 'node_id'>): MeshNode {
  return {
    long_name: 'N',
    short_name: 'N',
    hw_model: 'Repeater',
    snr: 0,
    battery: 0,
    last_heard: Math.floor(Date.now() / 1000),
    latitude: null,
    longitude: null,
    ...partial,
  };
}

function pathRecord(partial: Partial<PathRecord> & Pick<PathRecord, 'nodeId'>): PathRecord {
  return {
    pathHash: 'aa',
    hopCount: 1,
    pathBytes: [1],
    wasFloodDiscovery: false,
    successCount: 0,
    failureCount: 0,
    tripTimeMs: 0,
    routeWeight: 1,
    lastSuccessTs: null,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function names(rows: ReturnType<typeof prepareRepeaterSortRows>): string[] {
  return rows.map((r) => r.node.long_name);
}

describe('repeaterListSort', () => {
  it('defaults lastHeard desc and name/hops asc otherwise', () => {
    expect(DEFAULT_REPEATER_SORT).toEqual({ key: 'lastHeard', dir: 'desc' });
    expect(defaultRepeaterSortDir('lastHeard')).toBe('desc');
    expect(defaultRepeaterSortDir('name')).toBe('asc');
    expect(defaultRepeaterSortDir('hops')).toBe('asc');
    expect(defaultRepeaterSortDir('rssi')).toBe('desc');
  });

  it('nextRepeaterSort uses default dir then flips', () => {
    const next = nextRepeaterSort(DEFAULT_REPEATER_SORT, 'name');
    expect(next).toEqual({ key: 'name', dir: 'asc' });
    expect(nextRepeaterSort(next, 'name')).toEqual({ key: 'name', dir: 'desc' });
  });

  it('returns empty for empty input', () => {
    expect(prepareRepeaterSortRows([])).toEqual([]);
    expect(sortPreparedRepeaterRows([], 'lastHeard', 'desc')).toEqual([]);
  });

  it('defaults to favorites first then last-heard newest', () => {
    const now = Math.floor(Date.now() / 1000);
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Old', last_heard: now - 1000, favorited: false }),
      node({ node_id: 2, long_name: 'New', last_heard: now, favorited: false }),
      node({ node_id: 3, long_name: 'FavOld', last_heard: now - 100, favorited: true }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'lastHeard', 'desc'))).toEqual([
      'FavOld',
      'New',
      'Old',
    ]);
  });

  it('pins favorites for every sort key', () => {
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Alpha', rssi: -40, hops_away: 1, favorited: false }),
      node({ node_id: 2, long_name: 'Zulu', rssi: -90, hops_away: 5, favorited: true }),
    ]);
    for (const key of ['name', 'rssi', 'hops', 'lastHeard', 'status'] as const) {
      const sorted = sortPreparedRepeaterRows(prepared, key, defaultRepeaterSortDir(key));
      expect(sorted[0]?.node.long_name).toBe('Zulu');
    }
  });

  it.each([
    ['name', 'asc', ['Alpha', 'Mid', 'Zulu']],
    ['name', 'desc', ['Zulu', 'Mid', 'Alpha']],
  ] as const)('sorts %s %s', (key, dir, expected) => {
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 2, long_name: 'Mid' }),
      node({ node_id: 3, long_name: 'Zulu' }),
      node({ node_id: 1, long_name: 'Alpha' }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, key, dir))).toEqual(expected);
  });

  it('sorts lastHeard newest first and oldest first', () => {
    const now = Math.floor(Date.now() / 1000);
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Old', last_heard: now - 500 }),
      node({ node_id: 2, long_name: 'New', last_heard: now }),
      node({ node_id: 3, long_name: 'Mid', last_heard: now - 100 }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'lastHeard', 'desc'))).toEqual([
      'New',
      'Mid',
      'Old',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'lastHeard', 'asc'))).toEqual([
      'Old',
      'Mid',
      'New',
    ]);
  });

  it('sorts hops closest first and farthest first', () => {
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Far', hops_away: 5 }),
      node({ node_id: 2, long_name: 'Near', hops_away: 0 }),
      node({ node_id: 3, long_name: 'Mid', hops_away: 2 }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'hops', 'asc'))).toEqual([
      'Near',
      'Mid',
      'Far',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'hops', 'desc'))).toEqual([
      'Far',
      'Mid',
      'Near',
    ]);
  });

  it('sorts snr, rssi, uptime, airPct, and reliability both directions', () => {
    const statusByNodeId = new Map([
      [1, mockStatus({ lastSnr: 2, lastRssi: -80, totalUpTimeSecs: 100, totalAirTimeSecs: 10 })],
      [2, mockStatus({ lastSnr: 8, lastRssi: -40, totalUpTimeSecs: 500, totalAirTimeSecs: 250 })],
      [3, mockStatus({ lastSnr: 4, lastRssi: -60, totalUpTimeSecs: 200, totalAirTimeSecs: 40 })],
    ]);
    const pathHistory = new Map([
      [1, [pathRecord({ nodeId: 1, successCount: 1, failureCount: 3 })]],
      [2, [pathRecord({ nodeId: 2, successCount: 9, failureCount: 1 })]],
      [3, [pathRecord({ nodeId: 3, successCount: 2, failureCount: 2 })]],
    ]);
    const prepared = prepareRepeaterSortRows(
      [
        node({ node_id: 1, long_name: 'Low' }),
        node({ node_id: 2, long_name: 'High' }),
        node({ node_id: 3, long_name: 'Mid' }),
      ],
      { statusByNodeId, pathHistory },
    );
    expect(names(sortPreparedRepeaterRows(prepared, 'snr', 'desc'))).toEqual([
      'High',
      'Mid',
      'Low',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'snr', 'asc'))).toEqual(['Low', 'Mid', 'High']);
    expect(names(sortPreparedRepeaterRows(prepared, 'rssi', 'desc'))).toEqual([
      'High',
      'Mid',
      'Low',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'uptime', 'desc'))).toEqual([
      'High',
      'Mid',
      'Low',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'airPct', 'desc'))).toEqual([
      'High',
      'Mid',
      'Low',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'reliability', 'desc'))).toEqual([
      'High',
      'Mid',
      'Low',
    ]);
  });

  it('sorts status online first (desc) and offline first (asc)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Offline', last_heard: nowSec - 8 * 24 * 3600 }),
      node({ node_id: 2, long_name: 'Online', last_heard: nowSec }),
      node({ node_id: 3, long_name: 'Stale', last_heard: nowSec - 3 * 3600 }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'status', 'desc'))).toEqual([
      'Online',
      'Stale',
      'Offline',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'status', 'asc'))).toEqual([
      'Offline',
      'Stale',
      'Online',
    ]);
  });

  it('puts missing numerics last in both directions', () => {
    const prepared = prepareRepeaterSortRows(
      [
        node({ node_id: 1, long_name: 'Known', hops_away: 2, rssi: -50, snr: 4 }),
        node({ node_id: 2, long_name: 'Missing', hops_away: undefined, rssi: 0, snr: 0 }),
      ],
      {
        statusByNodeId: new Map([
          [1, mockStatus({ lastRssi: -50, lastSnr: 4, totalUpTimeSecs: 10, totalAirTimeSecs: 1 })],
        ]),
      },
    );
    expect(names(sortPreparedRepeaterRows(prepared, 'hops', 'asc'))).toEqual(['Known', 'Missing']);
    expect(names(sortPreparedRepeaterRows(prepared, 'hops', 'desc'))).toEqual(['Known', 'Missing']);
    expect(names(sortPreparedRepeaterRows(prepared, 'rssi', 'desc'))).toEqual(['Known', 'Missing']);
    expect(names(sortPreparedRepeaterRows(prepared, 'uptime', 'asc'))).toEqual([
      'Known',
      'Missing',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'airPct', 'desc'))).toEqual([
      'Known',
      'Missing',
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'reliability', 'desc'))).toEqual([
      'Known',
      'Missing',
    ]);
  });

  it('prefers status RPC SNR/RSSI over node fields', () => {
    const n = node({ node_id: 1, long_name: 'R', snr: 1, rssi: -90 });
    const status = mockStatus({ lastSnr: 7.5, lastRssi: -42 });
    expect(resolveRepeaterSnr(n, status)).toBe(7.5);
    expect(resolveRepeaterRssi(n, status)).toBe(-42);
  });

  it('sorts mixed Repeater and Room rows by name together', () => {
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 1, long_name: 'Zulu Room', hw_model: 'Room' }),
      node({ node_id: 2, long_name: 'Alpha Repeater', hw_model: 'Repeater' }),
    ]);
    expect(names(sortPreparedRepeaterRows(prepared, 'name', 'asc'))).toEqual([
      'Alpha Repeater',
      'Zulu Room',
    ]);
  });

  it('tie-breaks equal names on node_id', () => {
    const prepared = prepareRepeaterSortRows([
      node({ node_id: 20, long_name: 'Same' }),
      node({ node_id: 10, long_name: 'Same' }),
    ]);
    expect(sortPreparedRepeaterRows(prepared, 'name', 'asc').map((r) => r.node.node_id)).toEqual([
      10, 20,
    ]);
  });
});
