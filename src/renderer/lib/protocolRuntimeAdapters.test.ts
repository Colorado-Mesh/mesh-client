import { describe, expect, it, vi } from 'vitest';

import {
  asChannelIndexPills,
  asEnvironmentTelemetryPoints,
  asGpsIntervalChange,
  asMqttConnectionLoss,
  asNeighborInfoMap,
  asNumericNodeId,
  asOurPosition,
  asRadioDeviceOwner,
  asTelemetryPoints,
  asTraceRouteResult,
  asTraceRouteResultsMap,
  asWaypointMap,
  chatChannelsFromRuntimeChannels,
  traceRouteHopLabels,
} from './protocolRuntimeAdapters';

describe('protocolRuntimeAdapters', () => {
  it('asChannelIndexPills keeps named index slots and drops junk', () => {
    expect(
      asChannelIndexPills([
        { index: 1, name: 'Ops' },
        { index: 'x', name: 'Bad' },
        null,
        { index: 0, name: 'Primary' },
      ]),
    ).toEqual([
      { index: 1, name: 'Ops' },
      { index: 0, name: 'Primary' },
    ]);
  });

  it('chatChannelsFromRuntimeChannels mirrors App: Reticulum empty, MeshCore configured, else pills', () => {
    const channels = [
      { index: 0, name: 'General', secret: new Uint8Array(16).fill(0x11) },
      { index: 1, name: 'Unset', secret: new Uint8Array(16) },
    ];
    expect(
      chatChannelsFromRuntimeChannels(channels, {
        hasReticulumInterfaceConfig: true,
        hasCompanionContactManagementConfig: false,
      }),
    ).toEqual([]);
    expect(
      chatChannelsFromRuntimeChannels(channels, {
        hasReticulumInterfaceConfig: false,
        hasCompanionContactManagementConfig: true,
      }),
    ).toEqual([{ index: 0, name: 'General' }]);
    expect(
      chatChannelsFromRuntimeChannels([{ index: 2, name: 'Secondary' }, { name: 'no-index' }], {
        hasReticulumInterfaceConfig: false,
        hasCompanionContactManagementConfig: false,
      }),
    ).toEqual([{ index: 2, name: 'Secondary' }]);
  });

  it('asTraceRouteResult requires route[] and from', () => {
    expect(asTraceRouteResult(undefined)).toBeUndefined();
    expect(asTraceRouteResult({ from: 7 })).toBeUndefined();
    expect(asTraceRouteResult({ route: ['x'], from: 7 })).toBeUndefined();
    expect(asTraceRouteResult({ route: [2, 3], from: 7, timestamp: 9 })).toEqual({
      route: [2, 3],
      from: 7,
      timestamp: 9,
    });
    expect(asTraceRouteResult({ route: [2], from: 7 })).toEqual({
      route: [2],
      from: 7,
      timestamp: 0,
    });
  });

  it('traceRouteHopLabels matches the previous App Meshtastic-typed hop list', () => {
    const labels = (id: number) => (id === 1 ? '' : `N${id.toString(16)}`);
    expect(traceRouteHopLabels(undefined, 1, labels)).toBeUndefined();
    expect(traceRouteHopLabels({ route: [2], from: 3 }, 1, labels)).toEqual(['Me', 'N2', 'N3']);
  });

  it('asTraceRouteResultsMap drops unshaped entries', () => {
    const map = asTraceRouteResultsMap(
      new Map<number, unknown>([
        [1, { route: [2], from: 3, timestamp: 4 }],
        [2, { from: 9 }],
      ]),
    );
    expect([...map.entries()]).toEqual([[1, { route: [2], from: 3, timestamp: 4 }]]);
  });

  it('coerces ProtocolRuntime scalars used on the App path', () => {
    expect(asNumericNodeId(12, 99)).toBe(12);
    expect(asNumericNodeId('ab', 99)).toBe(99);
    expect(asNumericNodeId(null)).toBe(0);
    expect(asMqttConnectionLoss(null)).toBe(false);
    expect(asMqttConnectionLoss('lost')).toBe(true);
    expect(asOurPosition(null)).toBeNull();
    expect(asOurPosition({ lat: 1, lon: 2 })).toBeNull();
    expect(asOurPosition({ lat: 1, lon: 2, source: 'device', altitudeMeters: 10 })).toEqual({
      lat: 1,
      lon: 2,
      source: 'device',
      altitudeMeters: 10,
    });
    expect(asWaypointMap([])).toBeUndefined();
    const wp = new Map();
    expect(asWaypointMap(wp)).toBe(wp);
    expect(asTelemetryPoints(null)).toEqual([]);
    expect(asTelemetryPoints([{ timestamp: 1 }])).toEqual([{ timestamp: 1 }]);
    expect(asEnvironmentTelemetryPoints(null)).toEqual([]);
    expect(asEnvironmentTelemetryPoints([{ timestamp: 1, nodeNum: 2 }])).toEqual([
      { timestamp: 1, nodeNum: 2 },
    ]);
    expect(asRadioDeviceOwner(null)).toBeNull();
    expect(asRadioDeviceOwner({ longName: 'A' })).toEqual({
      longName: 'A',
      shortName: '',
      isLicensed: false,
    });
    const gps = vi.fn();
    asGpsIntervalChange(gps as (...args: never[]) => void)?.(30);
    expect(gps).toHaveBeenCalledWith(30);
    expect(asGpsIntervalChange(undefined)).toBeUndefined();
  });

  it('drops malformed map and array members before panels see them', () => {
    const goodWp = {
      id: 1,
      latitude: 40,
      longitude: -105,
      name: 'Camp',
      from: 2,
      timestamp: 3,
    };
    const waypoints = asWaypointMap(
      new Map<number, unknown>([
        [1, goodWp],
        [2, { id: 2, name: 'no-coords' }],
      ]),
    );
    expect([...waypoints!.entries()]).toEqual([[1, goodWp]]);

    expect(asTelemetryPoints([{ timestamp: 1 }, { batteryLevel: 80 }, null])).toEqual([
      { timestamp: 1 },
    ]);
    expect(
      asEnvironmentTelemetryPoints([
        { timestamp: 1, nodeNum: 9, temperature: 12 },
        { timestamp: 2 },
      ]),
    ).toEqual([{ timestamp: 1, nodeNum: 9, temperature: 12 }]);

    const goodNeighbor = {
      nodeId: 1,
      timestamp: 4,
      neighbors: [{ nodeId: 2, snr: 3, lastRxTime: 5 }],
    };
    const neighbors = asNeighborInfoMap(
      new Map<number, unknown>([
        [1, goodNeighbor],
        [2, { nodeId: 2, timestamp: 4, neighbors: [{ nodeId: 'x' }] }],
      ]),
    );
    expect([...neighbors.entries()]).toEqual([[1, goodNeighbor]]);
    expect(asNeighborInfoMap(undefined).size).toBe(0);
    expect(asNeighborInfoMap([]).size).toBe(0);
  });
});
