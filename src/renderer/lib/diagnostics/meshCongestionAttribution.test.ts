import { describe, expect, it } from 'vitest';

import type { NodeAnomaly } from '../types';
import type { PacketRecordLike } from './meshCongestionAttribution';
import {
  meshCongestionDetailLines,
  meshHasRoutingAnomalies,
  summarizeMeshCongestionAttribution,
  summarizeRfDuplicateOriginators,
} from './meshCongestionAttribution';

describe('summarizeRfDuplicateOriginators', () => {
  it('returns empty when no RF-only multi-path records', () => {
    const cache = new Map<number, PacketRecordLike & { fromNodeId: number }>();
    cache.set(1, { fromNodeId: 0x10, paths: [{ transport: 'rf' }] });
    cache.set(2, { fromNodeId: 0x10, paths: [{ transport: 'mqtt' }, { transport: 'rf' }] });
    expect(summarizeRfDuplicateOriginators(cache)).toEqual([]);
  });

  it('ranks originators by echo score for RF-only multi-path', () => {
    const cache = new Map<number, PacketRecordLike & { fromNodeId: number }>();
    // originator 0x10: two records with 2 and 3 paths → extra 1 + 2 = 3
    cache.set(1, { fromNodeId: 0x10, paths: [{ transport: 'rf' }, { transport: 'rf' }] });
    cache.set(2, {
      fromNodeId: 0x10,
      paths: [{ transport: 'rf' }, { transport: 'rf' }, { transport: 'rf' }],
    });
    // originator 0x20: one record 2 paths → extra 1
    cache.set(3, { fromNodeId: 0x20, paths: [{ transport: 'rf' }, { transport: 'rf' }] });
    const r = summarizeRfDuplicateOriginators(cache);
    expect(r.length).toBe(2);
    expect(r[0].nodeId).toBe(0x10);
    expect(r[0].echoScore).toBe(3);
    expect(r[0].recordCount).toBe(2);
    expect(r[1].nodeId).toBe(0x20);
    expect(r[1].echoScore).toBe(1);
  });
});

function anomaly(nodeId: number, type: NodeAnomaly['type']): NodeAnomaly {
  return {
    nodeId,
    type,
    severity: 'warning',
    description: 'test',
    detectedAt: Date.now(),
  };
}

describe('meshHasRoutingAnomalies', () => {
  it('returns false for empty map', () => {
    expect(meshHasRoutingAnomalies(new Map())).toBe(false);
  });

  it('returns false when only route_flapping', () => {
    const m = new Map<number, NodeAnomaly>();
    m.set(1, anomaly(1, 'route_flapping'));
    expect(meshHasRoutingAnomalies(m)).toBe(false);
  });

  it('returns true when bad_route present', () => {
    const m = new Map<number, NodeAnomaly>();
    m.set(1, anomaly(1, 'bad_route'));
    expect(meshHasRoutingAnomalies(m)).toBe(true);
  });

  it('returns true when hop_goblin present', () => {
    const m = new Map<number, NodeAnomaly>();
    m.set(1, anomaly(1, 'hop_goblin'));
    expect(meshHasRoutingAnomalies(m)).toBe(true);
  });
});

describe('meshCongestionDetailLines alwaysIncludeRoutingAnomalies', () => {
  it('appends routing line when insufficient evidence but routing anomalies exist', () => {
    const packetCache = new Map();
    const anomalies = new Map<number, NodeAnomaly>();
    anomalies.set(1, anomaly(1, 'bad_route'));
    const attr = summarizeMeshCongestionAttribution(packetCache, anomalies);
    expect(attr.sufficientEvidence).toBe(false);
    const lines = meshCongestionDetailLines(attr, {
      alwaysIncludeRoutingAnomalies: true,
    });
    expect(lines.some((l) => l.includes('routing anomalies'))).toBe(true);
  });
});
