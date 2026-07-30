import { MS_PER_SECOND } from '../shared/timeConstants';
import type { ReticulumSidecarAutoBeaconTracker } from './reticulumSidecarAutoBeaconTracker';

/** Sidecar stderr lines matching Reticulum AutoInterface beacon TX failures. */
const AUTO_BEACON_TX_FAILED_MARKER = 'auto: beacon TX failed';

const BEACON_FAIL_WARN_INTERVAL_MS = 60 * MS_PER_SECOND;

/** Default tracing filter for sidecar child processes (overridable via env). */
export const SIDECAR_DEFAULT_RUST_LOG = 'warn';

/**
 * Whether a sidecar stdout line should be written to the app log.
 * Tracing INFO/DEBUG packet routing floods the rotating log; keep WARN/ERROR only.
 */
export function shouldForwardReticulumSidecarStdout(text: string): boolean {
  const fields = text.trimStart().split(/\s+/);
  let index = fields[0] && Number.isFinite(Date.parse(fields[0])) ? 1 : 0;
  let severity = fields[index] ?? '';
  while (severity.startsWith('\u001b[')) {
    const end = severity.indexOf('m', 2);
    if (end < 0) return false;
    severity = severity.slice(end + 1);
    if (!severity) {
      index += 1;
      severity = fields[index] ?? '';
    }
  }
  return (
    severity === 'WARN' ||
    severity.startsWith('WARN\u001b[') ||
    severity === 'ERROR' ||
    severity.startsWith('ERROR\u001b[')
  );
}

/**
 * Resolve RUST_LOG for sidecar spawn. Honors MESH_CLIENT_RUST_LOG, then RUST_LOG,
 * else defaults to warn so INFO packet spam does not fill mesh-client.log.
 */
export function resolveSidecarRustLog(env: NodeJS.ProcessEnv = process.env): string {
  const fromMesh = env.MESH_CLIENT_RUST_LOG?.trim();
  if (fromMesh) return fromMesh;
  const fromRust = env.RUST_LOG?.trim();
  if (fromRust) return fromRust;
  return SIDECAR_DEFAULT_RUST_LOG;
}

export type ReticulumSidecarStderrSink = (message: string) => void;

export interface ReticulumSidecarStderrLogDecision {
  level: 'warn' | 'debug';
  message: string;
}

/** Rate-limits repetitive AutoInterface beacon TX failure stderr from the sidecar. */
export class ReticulumSidecarStderrDedupe {
  private lastBeaconFailWarnAt: number | null = null;
  private beaconFailSuppressed = 0;

  decide(text: string, nowMs = Date.now()): ReticulumSidecarStderrLogDecision {
    if (!text.includes(AUTO_BEACON_TX_FAILED_MARKER)) {
      return { level: 'warn', message: text };
    }
    if (
      this.lastBeaconFailWarnAt == null ||
      nowMs - this.lastBeaconFailWarnAt >= BEACON_FAIL_WARN_INTERVAL_MS
    ) {
      const message =
        this.beaconFailSuppressed > 0
          ? `${text} (suppressed ${this.beaconFailSuppressed} similar AutoInterface beacon TX failure lines)`
          : text;
      this.lastBeaconFailWarnAt = nowMs;
      this.beaconFailSuppressed = 0;
      return { level: 'warn', message };
    }
    this.beaconFailSuppressed += 1;
    return { level: 'debug', message: text };
  }

  /** Test-only reset. */
  resetForTests(): void {
    this.lastBeaconFailWarnAt = null;
    this.beaconFailSuppressed = 0;
  }
}

export function logReticulumSidecarStderrLine(
  text: string,
  dedupe: ReticulumSidecarStderrDedupe,
  sinks: { warn: ReticulumSidecarStderrSink; debug: ReticulumSidecarStderrSink },
  tracker?: ReticulumSidecarAutoBeaconTracker,
  nowMs?: number,
): void {
  const at = nowMs ?? Date.now();
  const decision = dedupe.decide(text, at);
  const suppressed = decision.level === 'debug' && text.includes(AUTO_BEACON_TX_FAILED_MARKER);
  tracker?.recordFailure(text, suppressed, at);
  if (decision.level === 'warn') {
    sinks.warn(decision.message);
  } else {
    sinks.debug(decision.message);
  }
}
