// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assembleEmcommReportJson,
  assembleEmcommReportMarkdown,
  type EmcommReportInput,
  escapeMarkdownCell,
} from './emcommReport';

const T0 = Date.parse('2026-09-24T10:00:00.000Z');

function mecpLine(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

function fixture(): EmcommReportInput {
  return {
    mecpLogLines: [
      mecpLine({
        ts: new Date(T0 + 60_000).toISOString(),
        protocol: 'meshtastic',
        severity: 0,
        drill: false,
        from: '!abcd1234',
        channel: 0,
        payload: 'MECP/0/M01',
        decoded: 'MAYDAY: medical',
        direction: 'received',
        messageId: 'm1',
      }),
      '',
      'not json',
      mecpLine({ ts: 'garbage', protocol: 'meshcore', severity: 1, drill: false, payload: 'x' }),
      mecpLine({
        ts: new Date(T0 + 120_000).toISOString(),
        protocol: 'meshcore',
        severity: 2,
        drill: true,
        payload: 'MECP/2/P05',
        direction: 'rebroadcast',
        toProtocol: 'meshtastic',
      }),
    ],
    nodeStatusEvents: [
      { node_id: '!beef0001', protocol: 'meshtastic', event_type: 'offline', ts_ms: T0 + 180_000 },
      { node_id: '!beef0001', protocol: 'meshtastic', event_type: 'went_stale', ts_ms: T0 },
      { node_id: '!abcd1234', protocol: 'meshtastic', event_type: 'online', ts_ms: T0 + 60_000 },
    ],
    incidents: [
      { id: 'inc-b', severity: 2, status: 'resolved', receivedAt: T0 + 120_000 },
      { id: 'inc-a', severity: 0, status: 'acked', receivedAt: T0 + 60_000, ackCount: 2 },
    ],
  };
}

describe('assembleEmcommReportJson', () => {
  it('builds a chronological timeline with kind tiebreak at equal timestamps', () => {
    const report = assembleEmcommReportJson(fixture());
    expect(report.timeline.map((e) => [e.ts_ms - T0, e.kind])).toEqual([
      [0, 'node_status'],
      [60_000, 'mecp'],
      [60_000, 'incident'],
      [60_000, 'node_status'],
      [120_000, 'mecp'],
      [120_000, 'incident'],
      [180_000, 'node_status'],
    ]);
  });

  it('is deterministic regardless of input order', () => {
    const a = fixture();
    const b: EmcommReportInput = {
      mecpLogLines: [...a.mecpLogLines].reverse(),
      nodeStatusEvents: [...a.nodeStatusEvents].reverse(),
      incidents: [...(a.incidents ?? [])].reverse(),
    };
    expect(assembleEmcommReportJson(b)).toEqual(assembleEmcommReportJson(a));
    expect(assembleEmcommReportMarkdown(b)).toBe(assembleEmcommReportMarkdown(a));
  });

  it('summarizes MECP, node status, and incidents; counts malformed lines', () => {
    const { summary, incidents, format, version } = assembleEmcommReportJson(fixture());
    expect(format).toBe('mesh-client-emcomm-report');
    expect(version).toBe(1);
    expect(summary.mecp).toEqual({
      total: 2,
      received: 1,
      rebroadcast: 1,
      drills: 1,
      bySeverity: { MAYDAY: 1, SAFETY: 1 },
      malformedLines: 2,
    });
    expect(summary.nodeStatus).toEqual({
      total: 3,
      byEventType: { offline: 1, online: 1, went_stale: 1 },
    });
    expect(summary.incidents).toEqual({
      total: 2,
      byStatus: { acked: 1, resolved: 1 },
      totalAcks: 2,
    });
    expect(summary.timeRange?.startMs).toBe(T0);
    expect(summary.timeRange?.endMs).toBe(T0 + 180_000);
    expect(incidents.map((i) => i.id)).toEqual(['inc-a', 'inc-b']);
    expect(incidents[1]?.ackCount).toBe(0);
  });

  it('prefers decoded text and maps MECP fields', () => {
    const first = assembleEmcommReportJson(fixture()).timeline.find((e) => e.kind === 'mecp');
    expect(first).toMatchObject({
      from: '!abcd1234',
      channel: '0',
      messageId: 'm1',
      text: 'MAYDAY: medical',
      severityLabel: 'MAYDAY',
      direction: 'received',
    });
  });

  it('includes generatedAt only when provided and handles empty input', () => {
    const empty = assembleEmcommReportJson({ mecpLogLines: [], nodeStatusEvents: [] });
    expect(empty).not.toHaveProperty('generatedAt');
    expect(empty.summary.timeRange).toBeNull();
    expect(empty.timeline).toEqual([]);
    expect(
      assembleEmcommReportJson({ mecpLogLines: [], nodeStatusEvents: [], generatedAtMs: T0 })
        .generatedAt,
    ).toBe('2026-09-24T10:00:00.000Z');
  });
});

describe('assembleEmcommReportMarkdown', () => {
  it('renders summary, incidents, and timeline tables', () => {
    const md = assembleEmcommReportMarkdown(fixture());
    expect(md).toContain('# EMCOMM Report');
    expect(md).toContain('- MECP messages: 2 (received 1, rebroadcast 1, drills 1)');
    expect(md).toContain('- Skipped malformed MECP log lines: 2');
    expect(md).toContain('| 2026-09-24T10:01:00.000Z | inc-a | MAYDAY | acked | 2 |');
    const timelineRows = md
      .split('\n')
      .filter((l) => l.startsWith('| 2026-') && /\| (MECP|Node|Incident) \|/.test(l));
    expect(timelineRows).toHaveLength(7);
    expect(timelineRows[0]).toContain('went\\_stale');
  });

  it('renders an empty timeline placeholder', () => {
    const md = assembleEmcommReportMarkdown({ mecpLogLines: [], nodeStatusEvents: [] });
    expect(md).toContain('Period: no events');
    expect(md).toContain('_No events._');
  });

  it('escapes mesh-sourced text so it cannot break tables or inject markup', () => {
    const md = assembleEmcommReportMarkdown({
      mecpLogLines: [
        mecpLine({
          ts: new Date(T0).toISOString(),
          protocol: 'meshtastic',
          severity: 3,
          drill: false,
          payload: 'a | b\n<script>[x](http://evil)',
        }),
      ],
      nodeStatusEvents: [],
    });
    expect(md).not.toContain('<script>');
    expect(md).toContain('a \\| b &lt;script&gt;\\[x\\]\\(http://evil\\)');
  });
});

describe('escapeMarkdownCell', () => {
  it('collapses newlines and escapes pipes/backslashes', () => {
    expect(escapeMarkdownCell('x\\y|z\r\nw')).toBe('x\\\\y\\|z w');
  });
});
