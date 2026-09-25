import { describe, expect, it } from 'vitest';

import { nodesToCsv, TOPOLOGY_NODE_FIELDS } from './exportFormats';
import { nodesToExportRows } from './nodeExportRows';
import type { MeshNode } from './types';

const NOW = 1_700_000_000_000;

function node(over: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 0xabcd,
    long_name: 'Alpha',
    short_name: 'A',
    hw_model: 'TBEAM',
    snr: 5,
    battery: 80,
    last_heard: NOW / 1000 - 60,
    latitude: 39.7,
    longitude: -105,
    channel_utilization: 12,
    air_util_tx: 3,
    ...over,
  };
}

describe('nodesToExportRows', () => {
  it('includes every topology field plus legacy fields', () => {
    const [row] = nodesToExportRows([node()], {
      protocol: 'meshtastic',
      staleThresholdMs: 3_600_000,
      offlineThresholdMs: 86_400_000,
      nowMs: NOW,
    });
    for (const f of TOPOLOGY_NODE_FIELDS) expect(row).toHaveProperty(f);
    expect(row.hex_id).toBe('!0000abcd');
    expect(row.protocol).toBe('meshtastic');
    expect(typeof row.health_score).toBe('number');
    expect(row.last_heard_unit).toBe('unix_sec');
  });

  it('derives status from protocol thresholds', () => {
    const rows = nodesToExportRows([node({ last_heard: 0 })], { protocol: 'meshcore', nowMs: NOW });
    expect(rows[0].status).toBe('offline');
  });

  it('serializes to CSV with status and health_score columns', () => {
    const csv = nodesToCsv(nodesToExportRows([node()], { protocol: 'meshtastic', nowMs: NOW }));
    const header = csv.split('\r\n')[0].split(',');
    expect(header).toContain('status');
    expect(header).toContain('health_score');
  });
});
