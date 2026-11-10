import { sanitizeLogMessage } from '@/main/sanitize-log-message';

export type MeshcoreRepeaterTimingPhase =
  'settle' | 'sent' | 'est' | 'reply' | 'timeout' | 'escalated';

export interface MeshcoreRepeaterTimingRecord {
  op: string;
  nodeId: number;
  hops?: number | null;
  correlationId: string;
  startedAtMs: number;
  phases: Partial<Record<MeshcoreRepeaterTimingPhase, number>>;
  pathSource?: string;
  estTimeoutMs?: number;
  queueDepth?: number;
}

let timingSeq = 0;

export function beginMeshcoreRepeaterTiming(opts: {
  op: string;
  nodeId: number;
  hops?: number | null;
  pathSource?: string;
  queueDepth?: number;
}): MeshcoreRepeaterTimingRecord {
  timingSeq = (timingSeq + 1) % 1_000_000;
  const correlationId = `${opts.op}:${opts.nodeId >>> 0}:${timingSeq}`;
  return {
    op: opts.op,
    nodeId: opts.nodeId >>> 0,
    hops: opts.hops,
    correlationId,
    startedAtMs: Date.now(),
    phases: {},
    pathSource: opts.pathSource,
    queueDepth: opts.queueDepth,
  };
}

export function markMeshcoreRepeaterTimingPhase(
  record: MeshcoreRepeaterTimingRecord,
  phase: MeshcoreRepeaterTimingPhase,
  extra?: { estTimeoutMs?: number; pathSource?: string },
): void {
  record.phases[phase] = Date.now() - record.startedAtMs;
  if (extra?.estTimeoutMs != null) record.estTimeoutMs = extra.estTimeoutMs;
  if (extra?.pathSource != null) record.pathSource = extra.pathSource;
}

function formatTimingLine(record: MeshcoreRepeaterTimingRecord, outcome: 'ok' | 'timeout'): string {
  const phaseParts = Object.entries(record.phases)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const hops = record.hops != null ? String(record.hops) : '?';
  const est = record.estTimeoutMs != null ? String(record.estTimeoutMs) : '-';
  const path = record.pathSource ? sanitizeLogMessage(record.pathSource) : '-';
  const qd = record.queueDepth != null ? String(record.queueDepth) : '-';
  return (
    `[meshcoreRepeaterTiming] ${outcome} id=${sanitizeLogMessage(record.correlationId)} ` +
    `op=${sanitizeLogMessage(record.op)} node=${record.nodeId} hops=${hops} est=${est} ` +
    `path=${path} queueDepth=${qd} ${phaseParts}`.trim()
  );
}

export function logMeshcoreRepeaterTimingSuccess(record: MeshcoreRepeaterTimingRecord): void {
  markMeshcoreRepeaterTimingPhase(record, 'reply');
  console.debug(formatTimingLine(record, 'ok'));
}

export function logMeshcoreRepeaterTimingTimeout(record: MeshcoreRepeaterTimingRecord): void {
  markMeshcoreRepeaterTimingPhase(record, 'timeout');
  console.warn(formatTimingLine(record, 'timeout'));
}

/** Test helper. */
export function resetMeshcoreRepeaterTimingSeqForTests(): void {
  timingSeq = 0;
}
