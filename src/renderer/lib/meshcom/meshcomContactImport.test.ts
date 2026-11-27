import { describe, expect, it } from 'vitest';

import { TOPOLOGY_EXPORT_FORMAT } from '../exportFormats';
import { nodesToExportRows } from '../nodeExportRows';
import type { MeshNode } from '../types';
import { parseMeshcomContactsImport } from './meshcomContactImport';

describe('parseMeshcomContactsImport', () => {
  it('parses a raw JSON array of MeshCom-shaped contacts', () => {
    const { rows, skipped, errors } = parseMeshcomContactsImport(
      JSON.stringify([
        {
          callsign: 'OE1KFR-1',
          lat: 48.2,
          lon: 16.37,
          favorited: 1,
          hw_id: 4,
          last_heard: 1_700_000,
        },
      ]),
    );
    expect(errors).toEqual([]);
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].callsign).toBe('OE1KFR-1');
    expect(rows[0].lat).toBe(48.2);
    expect(rows[0].favorited).toBe(true);
    expect(rows[0].hw_id).toBe(4);
    expect(rows[0].last_heard).toBe(1_700_000_000);
  });

  it('parses Node List topology export (meshcom) with unix_sec last_heard', () => {
    const node: MeshNode = {
      node_id: 12345,
      long_name: 'DH1FR-7',
      short_name: 'DH1F',
      hw_model: 'TLORA',
      snr: 0,
      battery: 0,
      last_heard: 1_700_000_000,
      latitude: 50.1,
      longitude: 8.7,
      favorited: true,
    };
    const payload = {
      format: TOPOLOGY_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodesToExportRows([node], { protocol: 'meshcom' }),
    };
    const { rows } = parseMeshcomContactsImport(JSON.stringify(payload));
    expect(rows).toHaveLength(1);
    expect(rows[0].callsign).toBe('DH1FR-7');
    expect(rows[0].lat).toBe(50.1);
    expect(rows[0].lon).toBe(8.7);
    expect(rows[0].favorited).toBe(true);
    expect(rows[0].last_heard).toBe(1_700_000_000_000);
  });

  it('parses RFC 4180 CSV with header aliases', () => {
    const csv = [
      'callsign,latitude,longitude,favorited,last_heard,last_heard_unit',
      'N0CALL-9,39.74,-104.99,true,1700000000,unix_sec',
    ].join('\r\n');
    const { rows } = parseMeshcomContactsImport(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].callsign).toBe('N0CALL-9');
    expect(rows[0].favorited).toBe(true);
    expect(rows[0].last_heard).toBe(1_700_000_000_000);
  });

  it('skips non-meshcom protocol rows in topology export', () => {
    const { rows, skipped } = parseMeshcomContactsImport(
      JSON.stringify({
        nodes: [
          { long_name: 'MESH-1', protocol: 'meshcore' },
          { long_name: 'HAMS-1', protocol: 'meshcom', latitude: 1, longitude: 2 },
        ],
      }),
    );
    expect(skipped).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].callsign).toBe('HAMS-1');
  });

  it('returns parse errors for invalid JSON', () => {
    const { rows, errors } = parseMeshcomContactsImport('{not-json');
    expect(rows).toHaveLength(0);
    expect(errors).toContain('Invalid JSON');
  });
});
