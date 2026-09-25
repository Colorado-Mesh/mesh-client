import { describe, expect, it } from 'vitest';

import {
  diagnosticsRowsToJson,
  nodesToCsv,
  nodesToTopologyJson,
  toJsonSafe,
  TOPOLOGY_NODE_FIELDS,
} from './exportFormats';

const EXPORTED_AT = '2026-09-24T12:00:00.000Z';

describe('nodesToCsv', () => {
  it('returns empty string for no rows/columns', () => {
    expect(nodesToCsv([])).toBe('');
    expect(nodesToCsv([{}])).toBe('');
  });

  it('orders known topology fields first, then extra keys in first-seen order', () => {
    const csv = nodesToCsv([
      { zeta: 1, long_name: 'Alpha', node_id: 1 },
      { node_id: 2, hw_model: 'RAK4631', battery: 80 },
    ]);
    const [header, row1, row2] = csv.split('\r\n');
    expect(header).toBe('node_id,long_name,battery,zeta,hw_model');
    expect(row1).toBe('1,Alpha,,1,');
    expect(row2).toBe('2,,80,,RAK4631');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    const csv = nodesToCsv([{ node_id: 1, long_name: 'Base "Camp", North\nRidge' }]);
    expect(csv.split('\r\n')[1]).toBe('1,"Base ""Camp"", North\nRidge"');
  });

  it('neutralizes spreadsheet formula prefixes but keeps negative numbers', () => {
    const csv = nodesToCsv([
      { node_id: 1, long_name: '=HYPERLINK("x")', short_name: '@cmd', longitude: -105.2 },
      { node_id: 2, long_name: '-105', short_name: '-abc', longitude: '-104.9' },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`1,"'=HYPERLINK(""x"")",'@cmd,-105.2`);
    expect(lines[2]).toBe(`2,-105,'-abc,-104.9`);
  });

  it('serializes non-finite numbers as empty and objects as JSON', () => {
    const csv = nodesToCsv([{ node_id: 1, battery: Number.NaN, meta: { a: 1 } }]);
    expect(csv.split('\r\n')[1]).toBe('1,,"{""a"":1}"');
  });
});

describe('nodesToTopologyJson', () => {
  it('emits every topology field with null for missing values', () => {
    const out = nodesToTopologyJson(
      [
        {
          node_id: '!abcd1234',
          long_name: 'Alpha',
          status: 'online',
          health_score: 92,
          latitude: 39.7,
          longitude: -105,
          protocol: 'meshtastic',
          last_heard: 1_700_000_000,
          hw_model: 'ignored',
        },
      ],
      { exportedAt: EXPORTED_AT },
    );
    expect(out.format).toBe('mesh-client-topology');
    expect(out.version).toBe(1);
    expect(out.exportedAt).toBe(EXPORTED_AT);
    expect(out.nodeCount).toBe(1);
    expect(Object.keys(out.nodes[0] ?? {})).toEqual([...TOPOLOGY_NODE_FIELDS]);
    expect(out.nodes[0]).toMatchObject({
      node_id: '!abcd1234',
      short_name: null,
      battery: null,
      health_score: 92,
    });
    expect(out.nodes[0]).not.toHaveProperty('hw_model');
  });

  it('is JSON round-trippable', () => {
    const out = nodesToTopologyJson([{ node_id: 1, battery: Infinity }], {
      exportedAt: EXPORTED_AT,
    });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.nodes[0]?.battery).toBeNull();
  });

  it('defaults exportedAt to an ISO timestamp', () => {
    expect(nodesToTopologyJson([]).exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('diagnosticsRowsToJson', () => {
  it('wraps rows with metadata and makes runtime values JSON-safe', () => {
    const cyc: Record<string, unknown> = { id: 'c' };
    cyc.self = cyc;
    const out = diagnosticsRowsToJson(
      [
        { kind: 'hop_goblin', nodeIds: new Set([1, 2]), counts: new Map([['a', 1n]]) },
        cyc,
        undefined,
      ],
      { exportedAt: EXPORTED_AT },
    );
    expect(out).toEqual({
      format: 'mesh-client-diagnostics',
      version: 1,
      exportedAt: EXPORTED_AT,
      rowCount: 3,
      rows: [
        { kind: 'hop_goblin', nodeIds: [1, 2], counts: { a: '1' } },
        { id: 'c', self: '[Circular]' },
        null,
      ],
    });
  });
});

describe('toJsonSafe', () => {
  it('drops functions/symbols, converts dates, and allows shared non-cyclic refs', () => {
    const shared = { x: 1 };
    expect(
      toJsonSafe({
        fn: () => 1,
        sym: Symbol('s'),
        when: new Date(EXPORTED_AT),
        a: shared,
        b: shared,
      }),
    ).toEqual({ when: EXPORTED_AT, a: { x: 1 }, b: { x: 1 } });
  });
});
