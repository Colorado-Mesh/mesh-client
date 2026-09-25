/**
 * Pure EMCOMM after-action report assembly (JSON + Markdown) from the MECP audit log,
 * node status transitions, and incident snapshots. No I/O — callers read inputs.
 * Report text is an English export artifact (like GPX / support bundle), not UI copy.
 */

import type { MecpReceivedLogEntry } from './mecp-received-log';

export const EMCOMM_REPORT_FORMAT = 'mesh-client-emcomm-report';
export const EMCOMM_REPORT_VERSION = 1;

export type NodeStatusEventType = 'went_stale' | 'offline' | 'online';

export interface EmcommNodeStatusEvent {
  node_id: string;
  protocol: string;
  event_type: string;
  ts_ms: number;
}

export interface EmcommIncidentInput {
  id: string;
  severity: number;
  status: string;
  receivedAt: number;
  ackCount?: number;
}

export interface EmcommReportInput {
  /** Raw `mecp-received.log` JSONL lines (blank / malformed lines are counted and skipped). */
  mecpLogLines: string[];
  nodeStatusEvents: EmcommNodeStatusEvent[];
  incidents?: EmcommIncidentInput[];
  /** Report generation time (epoch ms). Omitted from output when unset so assembly stays pure. */
  generatedAtMs?: number;
}

export type EmcommTimelineEntry =
  | {
      kind: 'mecp';
      ts_ms: number;
      ts: string;
      direction: 'received' | 'rebroadcast';
      protocol: string;
      severity: number | null;
      severityLabel: string;
      drill: boolean;
      from: string | null;
      channel: string | null;
      messageId: string | null;
      text: string;
    }
  | {
      kind: 'incident';
      ts_ms: number;
      ts: string;
      incidentId: string;
      severity: number;
      severityLabel: string;
      status: string;
      ackCount: number;
    }
  | {
      kind: 'node_status';
      ts_ms: number;
      ts: string;
      node_id: string;
      protocol: string;
      event_type: string;
    };

export interface EmcommReportSummary {
  timeRange: { startMs: number; endMs: number; start: string; end: string } | null;
  mecp: {
    total: number;
    received: number;
    rebroadcast: number;
    drills: number;
    bySeverity: Record<string, number>;
    malformedLines: number;
  };
  nodeStatus: { total: number; byEventType: Record<string, number> };
  incidents: { total: number; byStatus: Record<string, number>; totalAcks: number };
}

export interface EmcommReportJson {
  format: typeof EMCOMM_REPORT_FORMAT;
  version: number;
  generatedAt?: string;
  summary: EmcommReportSummary;
  incidents: (EmcommIncidentInput & { receivedAtIso: string; severityLabel: string })[];
  timeline: EmcommTimelineEntry[];
}

const SEVERITY_LABELS: Record<number, string> = {
  0: 'MAYDAY',
  1: 'URGENT',
  2: 'SAFETY',
  3: 'ROUTINE',
};

/** Same-timestamp tiebreak: the message, then the incident it opened, then node transitions. */
const KIND_ORDER: Record<EmcommTimelineEntry['kind'], number> = {
  mecp: 0,
  incident: 1,
  node_status: 2,
};

export function emcommSeverityLabel(severity: number | null | undefined): string {
  if (severity == null) return 'UNKNOWN';
  return SEVERITY_LABELS[severity] ?? `SEVERITY ${severity}`;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function optString(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function parseMecpLines(lines: readonly string[]): {
  entries: Extract<EmcommTimelineEntry, { kind: 'mecp' }>[];
  malformed: number;
} {
  const entries: Extract<EmcommTimelineEntry, { kind: 'mecp' }>[] = [];
  let malformed = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let rec: Partial<Record<keyof MecpReceivedLogEntry, unknown>>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        malformed += 1;
        continue;
      }
      rec = parsed;
    } catch {
      // catch-no-log-ok malformed audit lines are counted in the report summary
      malformed += 1;
      continue;
    }
    const tsMs = typeof rec.ts === 'string' ? Date.parse(rec.ts) : Number.NaN;
    if (!Number.isFinite(tsMs)) {
      malformed += 1;
      continue;
    }
    const severity =
      typeof rec.severity === 'number' && Number.isInteger(rec.severity) ? rec.severity : null;
    entries.push({
      kind: 'mecp',
      ts_ms: tsMs,
      ts: isoOf(tsMs),
      direction: rec.direction === 'rebroadcast' ? 'rebroadcast' : 'received',
      protocol: optString(rec.protocol) ?? 'unknown',
      severity,
      severityLabel: emcommSeverityLabel(severity),
      drill: rec.drill === true,
      from: optString(rec.from),
      channel: optString(rec.channel),
      messageId: optString(rec.messageId),
      text: optString(rec.decoded) ?? optString(rec.payload) ?? '',
    });
  }
  return { entries, malformed };
}

function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Secondary key so equal (ts, kind) pairs sort identically regardless of input order. */
function entryTiebreak(e: EmcommTimelineEntry): string {
  switch (e.kind) {
    case 'mecp':
      return `${e.messageId ?? ''}\u0000${e.from ?? ''}\u0000${e.direction}\u0000${e.text}`;
    case 'incident':
      return e.incidentId;
    case 'node_status':
      return `${e.protocol}\u0000${e.node_id}\u0000${e.event_type}`;
  }
}

function buildTimeline(input: EmcommReportInput): {
  timeline: EmcommTimelineEntry[];
  malformed: number;
} {
  const { entries: mecp, malformed } = parseMecpLines(input.mecpLogLines);
  const timeline: EmcommTimelineEntry[] = [...mecp];

  for (const inc of input.incidents ?? []) {
    if (!Number.isFinite(inc.receivedAt)) continue;
    timeline.push({
      kind: 'incident',
      ts_ms: inc.receivedAt,
      ts: isoOf(inc.receivedAt),
      incidentId: inc.id,
      severity: inc.severity,
      severityLabel: emcommSeverityLabel(inc.severity),
      status: inc.status,
      ackCount: inc.ackCount ?? 0,
    });
  }

  for (const ev of input.nodeStatusEvents) {
    if (!Number.isFinite(ev.ts_ms)) continue;
    timeline.push({
      kind: 'node_status',
      ts_ms: ev.ts_ms,
      ts: isoOf(ev.ts_ms),
      node_id: ev.node_id,
      protocol: ev.protocol,
      event_type: ev.event_type,
    });
  }

  timeline.sort(
    (a, b) =>
      a.ts_ms - b.ts_ms ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      compareStr(entryTiebreak(a), entryTiebreak(b)),
  );
  return { timeline, malformed };
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function assembleEmcommReportJson(input: EmcommReportInput): EmcommReportJson {
  const { timeline, malformed } = buildTimeline(input);

  const mecp: EmcommReportSummary['mecp'] = {
    total: 0,
    received: 0,
    rebroadcast: 0,
    drills: 0,
    bySeverity: {},
    malformedLines: malformed,
  };
  const nodeStatus: EmcommReportSummary['nodeStatus'] = { total: 0, byEventType: {} };
  for (const e of timeline) {
    if (e.kind === 'mecp') {
      mecp.total += 1;
      if (e.direction === 'rebroadcast') mecp.rebroadcast += 1;
      else mecp.received += 1;
      if (e.drill) mecp.drills += 1;
      bump(mecp.bySeverity, e.severityLabel);
    } else if (e.kind === 'node_status') {
      nodeStatus.total += 1;
      bump(nodeStatus.byEventType, e.event_type);
    }
  }

  const incidents = [...(input.incidents ?? [])]
    .filter((inc) => Number.isFinite(inc.receivedAt))
    .sort((a, b) => a.receivedAt - b.receivedAt || compareStr(a.id, b.id))
    .map((inc) => ({
      ...inc,
      ackCount: inc.ackCount ?? 0,
      receivedAtIso: isoOf(inc.receivedAt),
      severityLabel: emcommSeverityLabel(inc.severity),
    }));
  const byStatus: Record<string, number> = {};
  let totalAcks = 0;
  for (const inc of incidents) {
    bump(byStatus, inc.status);
    totalAcks += inc.ackCount;
  }

  const first = timeline[0];
  const last = timeline[timeline.length - 1];
  const summary: EmcommReportSummary = {
    timeRange:
      first && last
        ? { startMs: first.ts_ms, endMs: last.ts_ms, start: first.ts, end: last.ts }
        : null,
    mecp,
    nodeStatus,
    incidents: { total: incidents.length, byStatus, totalAcks },
  };

  return {
    format: EMCOMM_REPORT_FORMAT,
    version: EMCOMM_REPORT_VERSION,
    ...(input.generatedAtMs != null && Number.isFinite(input.generatedAtMs)
      ? { generatedAt: isoOf(input.generatedAtMs) }
      : {}),
    summary,
    incidents,
    timeline,
  };
}

/** Escape mesh-sourced text for a single Markdown table cell (no HTML, links, or row breaks). */
export function escapeMarkdownCell(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([|`*_[\]()#!~])/g, '\\$1')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

function formatCounts(counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort();
  if (keys.length === 0) return 'none';
  return keys.map((k) => `${escapeMarkdownCell(k)}: ${counts[k]}`).join(', ');
}

function describeEntry(e: EmcommTimelineEntry): { kind: string; source: string; detail: string } {
  switch (e.kind) {
    case 'mecp': {
      const tags = [e.severityLabel, e.drill ? 'DRILL' : null, e.direction.toUpperCase()]
        .filter(Boolean)
        .join(' ');
      const channel = e.channel != null ? ` ch ${e.channel}` : '';
      return {
        kind: 'MECP',
        source: `${e.from ?? 'unknown'} (${e.protocol}${channel})`,
        detail: `${tags}: ${e.text}`,
      };
    }
    case 'incident':
      return {
        kind: 'Incident',
        source: e.incidentId,
        detail: `${e.severityLabel} — status ${e.status}, acks ${e.ackCount}`,
      };
    case 'node_status':
      return {
        kind: 'Node',
        source: `${e.node_id} (${e.protocol})`,
        detail: e.event_type,
      };
  }
}

export function assembleEmcommReportMarkdown(input: EmcommReportInput): string {
  const report = assembleEmcommReportJson(input);
  const { summary } = report;
  const out: string[] = ['# EMCOMM Report', ''];

  if (report.generatedAt) out.push(`Generated: ${report.generatedAt}`, '');
  out.push(
    `Period: ${summary.timeRange ? `${summary.timeRange.start} → ${summary.timeRange.end}` : 'no events'}`,
    '',
    '## Summary',
    '',
    `- MECP messages: ${summary.mecp.total} (received ${summary.mecp.received}, rebroadcast ${summary.mecp.rebroadcast}, drills ${summary.mecp.drills})`,
    `- MECP by severity: ${formatCounts(summary.mecp.bySeverity)}`,
    `- Node status events: ${summary.nodeStatus.total} (${formatCounts(summary.nodeStatus.byEventType)})`,
    `- Incidents: ${summary.incidents.total} (${formatCounts(summary.incidents.byStatus)}), acks ${summary.incidents.totalAcks}`,
  );
  if (summary.mecp.malformedLines > 0) {
    out.push(`- Skipped malformed MECP log lines: ${summary.mecp.malformedLines}`);
  }
  out.push('');

  if (report.incidents.length > 0) {
    out.push(
      '## Incidents',
      '',
      '| Received (UTC) | ID | Severity | Status | Acks |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const inc of report.incidents) {
      out.push(
        `| ${inc.receivedAtIso} | ${escapeMarkdownCell(inc.id)} | ${inc.severityLabel} | ${escapeMarkdownCell(inc.status)} | ${inc.ackCount} |`,
      );
    }
    out.push('');
  }

  out.push('## Timeline', '');
  if (report.timeline.length === 0) {
    out.push('_No events._', '');
  } else {
    out.push('| Time (UTC) | Type | Source | Detail |', '| --- | --- | --- | --- |');
    for (const e of report.timeline) {
      const d = describeEntry(e);
      out.push(
        `| ${e.ts} | ${d.kind} | ${escapeMarkdownCell(d.source)} | ${escapeMarkdownCell(d.detail)} |`,
      );
    }
    out.push('');
  }

  return out.join('\n');
}
