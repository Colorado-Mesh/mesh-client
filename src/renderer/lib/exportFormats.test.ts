import { describe, expect, it } from 'vitest';

import {
  diagnosticsRowsToJson,
  INCIDENT_EXPORT_FIELDS,
  INCIDENT_EXPORT_FORMAT,
  incidentsToCsv,
  incidentsToExportRows,
  incidentsToJson,
  nodesToCsv,
  nodesToTopologyJson,
  toJsonSafe,
  TOPOLOGY_NODE_FIELDS,
} from './exportFormats';
import type { EmergencyIncident } from './mecp/incidentTypes';

const EXPORTED_AT = '2026-09-24T12:00:00.000Z';

function incident(overrides: Partial<EmergencyIncident> = {}): EmergencyIncident {
  return {
    id: 'fp-1',
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic', 'meshcore'],
    severity: 0,
    codes: ['M01', 'B01'],
    freetext: 'leg injury',
    senderId: '3735928559',
    senderName: 'Ada',
    relaySenderIds: ['42'],
    channel: '0',
    receivedAt: Date.UTC(2026, 8, 24, 10, 0, 0),
    lastSeenAt: Date.UTC(2026, 8, 24, 10, 5, 0),
    lat: 39.7,
    lon: -105.0,
    coordsSource: 'message',
    messageIds: ['m1'],
    ackCount: 2,
    ackPeerIds: ['7', '8'],
    beaconActive: true,
    beaconAcked: false,
    isDrill: false,
    status: 'acked',
    ...overrides,
  };
}

describe('incident log export', () => {
  it('maps every incident oldest first with ISO timestamps and nulls for missing values', () => {
    const resolved = incident({
      id: 'fp-0',
      status: 'resolved',
      receivedAt: Date.UTC(2026, 8, 24, 9, 0, 0),
      resolvedAt: Date.UTC(2026, 8, 24, 9, 30, 0),
      lat: undefined,
      lon: undefined,
      coordsSource: null,
      relaySenderIds: undefined,
    });
    const rows = incidentsToExportRows([incident(), resolved]);
    expect(rows.map((r) => r.id)).toEqual(['fp-0', 'fp-1']);
    expect(rows[0]).toMatchObject({
      status: 'resolved',
      received_at: '2026-09-24T09:00:00.000Z',
      resolved_at: '2026-09-24T09:30:00.000Z',
      latitude: null,
      longitude: null,
      coords_source: null,
      relay_sender_ids: [],
    });
    expect(rows[1].resolved_at).toBeNull();
    expect(Object.keys(rows[1])).toEqual([...INCIDENT_EXPORT_FIELDS]);
  });

  it('wraps rows in a versioned JSON envelope', () => {
    const rows = incidentsToExportRows([incident()]);
    const json = incidentsToJson(rows, { exportedAt: EXPORTED_AT });
    expect(json).toMatchObject({
      format: INCIDENT_EXPORT_FORMAT,
      version: 1,
      exportedAt: EXPORTED_AT,
      incidentCount: 1,
    });
    expect(json.incidents[0]).toMatchObject({ codes: ['M01', 'B01'], ack_peer_ids: ['7', '8'] });
  });

  it('writes CSV in field order with space-joined lists and injection-guarded text', () => {
    const csv = incidentsToCsv(incidentsToExportRows([incident({ freetext: '=HYPERLINK(1)' })]));
    const [header, line] = csv.trimEnd().split('\r\n');
    expect(header).toBe(INCIDENT_EXPORT_FIELDS.join(','));
    const cells = line.split(',');
    const col = (f: (typeof INCIDENT_EXPORT_FIELDS)[number]) =>
      cells[INCIDENT_EXPORT_FIELDS.indexOf(f)];
    expect(col('codes')).toBe('M01 B01');
    expect(col('protocols_seen')).toBe('meshtastic meshcore');
    expect(col('freetext')).toBe("'=HYPERLINK(1)");
    expect(col('received_at')).toBe('2026-09-24T10:00:00.000Z');
  });

  it('neutralizes leading minus formulas and LF in incident text', () => {
    const csv = incidentsToCsv(
      incidentsToExportRows([incident({ freetext: '-1+2', senderName: '\n=cmd' })]),
    );
    const [, line] = csv.trimEnd().split('\r\n');
    expect(line).toContain(`,'-1+2,`);
    expect(line).toContain(`,"'\n=cmd",`);
  });

  it('exports out-of-range timestamps as null instead of throwing', () => {
    const rows = incidentsToExportRows([
      incident({ lastSeenAt: 1e20, resolvedAt: Number.POSITIVE_INFINITY }),
    ]);
    expect(rows[0]).toMatchObject({ last_seen_at: null, resolved_at: null });
    expect(() => incidentsToCsv(rows)).not.toThrow();
  });

  it('writes only the header for no incidents', () => {
    expect(incidentsToCsv([])).toBe(INCIDENT_EXPORT_FIELDS.join(',') + '\r\n');
  });

  it('exports the event timeline as JSON objects and a compact CSV cell', () => {
    const withEvents = incident({
      events: [
        {
          at: Date.UTC(2026, 8, 24, 10, 0, 0),
          kind: 'received',
          peerId: '3735928559',
          protocol: 'meshtastic',
        },
        { at: Date.UTC(2026, 8, 24, 10, 1, 0), kind: 'ackHeard', peerId: '7' },
        { at: Date.UTC(2026, 8, 24, 10, 2, 0), kind: 'ackSent' },
      ],
    });
    const rows = incidentsToExportRows([withEvents, incident({ id: 'legacy', events: undefined })]);
    expect(rows[0].events).toEqual([
      {
        at: '2026-09-24T10:00:00.000Z',
        kind: 'received',
        peer_id: '3735928559',
        protocol: 'meshtastic',
      },
      { at: '2026-09-24T10:01:00.000Z', kind: 'ackHeard', peer_id: '7', protocol: null },
      { at: '2026-09-24T10:02:00.000Z', kind: 'ackSent', peer_id: null, protocol: null },
    ]);
    expect(rows[1].events).toEqual([]);

    const [, line] = incidentsToCsv([rows[0]]).trimEnd().split('\r\n');
    expect(
      line.endsWith(
        ',2026-09-24T10:00:00.000Z received 3735928559 meshtastic; ' +
          '2026-09-24T10:01:00.000Z ackHeard 7; 2026-09-24T10:02:00.000Z ackSent',
      ),
    ).toBe(true);
  });
});

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
