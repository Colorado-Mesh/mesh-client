import { MS_PER_SECOND } from '../shared/timeConstants';
import type { ReticulumSidecarAutoBeaconTracker } from './reticulumSidecarAutoBeaconTracker';
import { sanitizeLogMessage } from './sanitize-log-message';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_SEQUENCE = /\u001b\[[0-9;?]*[A-Za-z]/g;

/**
 * Strip ANSI color codes before sanitizing: sanitize turns ESC into a space, leaving
 * `[32m` fragments that hide the tracing level/target from the forward filter.
 */
export function normalizeReticulumSidecarOutputLine(raw: string): string {
  return sanitizeLogMessage(raw.replace(ANSI_CSI_SEQUENCE, ''));
}

/** Sidecar stderr lines matching Reticulum AutoInterface beacon TX failures. */
const AUTO_BEACON_TX_FAILED_MARKER = 'auto: beacon TX failed';

export function isReticulumSidecarAutoBeaconTxFailure(text: string): boolean {
  return text.includes(AUTO_BEACON_TX_FAILED_MARKER);
}

const BEACON_FAIL_WARN_INTERVAL_MS = 60 * MS_PER_SECOND;

/** Default tracing filter for sidecar child processes (overridable via env). */
// PN connect triage: keep global warn; surface sync/deposit/outbound INFO. Keep
// propagation-retrieve at info for pn_hash / establish / failover lines; per-message
// inbound delivery records stay debug-only with redacted from_prefix in live.rs.
// `gatt` INFO carries LoRa BLE connect stage timings (which step hung on Windows).
// `rns_interface::tcp` INFO (`reconnecting in … name=`) is not forwarded to the app log;
// the interface issue tracker needs it to map `interface_id` to a hub name.
export const SIDECAR_DEFAULT_RUST_LOG =
  'warn,propagation-sync=info,propagation-retrieve=info,propagation-deposit=info,lxmf-outbound=info,rrc=info,gatt=info,rns_interface::tcp=info';

/**
 * Whether a normalized sidecar tracing line should be written to the app log.
 * Tracing INFO/DEBUG packet routing floods the rotating log; keep WARN/ERROR, plus
 * PN triage targets that RUST_LOG elevates to INFO (`propagation-sync`, etc.).
 * Callers strip CSI first via `normalizeReticulumSidecarOutputLine`.
 */
const SIDECAR_STDOUT_INFO_FORWARD_MARKERS = [
  'propagation-sync',
  'propagation-retrieve',
  'propagation-deposit',
  'lxmf-outbound',
  'rrc',
  'gatt',
] as const;

export function shouldForwardReticulumSidecarStdout(text: string): boolean {
  const fields = text.trimStart().split(/\s+/);
  const index = fields[0] && Number.isFinite(Date.parse(fields[0])) ? 1 : 0;
  const severity = fields[index] ?? '';
  if (severity === 'WARN' || severity === 'ERROR') {
    return true;
  }
  // INFO for PN / RRC / GATT triage only (matches SIDECAR_DEFAULT_RUST_LOG targets).
  if (severity !== 'INFO') return false;
  // Match markers against the tracing target token only — not message text / other fields.
  let target = (fields[index + 1] ?? '').replace(/:$/, '').toLowerCase();
  if (target.startsWith('target=')) {
    target = target.slice('target='.length);
  }
  if (!target) return false;
  return SIDECAR_STDOUT_INFO_FORWARD_MARKERS.some((marker) => target.includes(marker));
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
    if (!isReticulumSidecarAutoBeaconTxFailure(text)) {
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

const TCP_READ_ERROR_MARKER = 'TCP read error';
const TCP_READ_ERROR_WARN_INTERVAL_MS = 60 * MS_PER_SECOND;
const INTERFACE_ID_RE = /interface_id\s*=\s*(\d+)/i;

interface TcpReadErrorWindow {
  lastWarnAt: number;
  suppressed: number;
}

/**
 * Rate-limits `TCP read error` lines per sidecar `interface_id`. A hub that accepts then
 * resets every connection makes rsReticulum retry every ~5s without backing off.
 */
export class ReticulumSidecarTcpReadErrorDedupe {
  private windows = new Map<number, TcpReadErrorWindow>();

  constructor(private readonly resolveName?: (interfaceId: number) => string | undefined) {}

  decide(text: string, nowMs = Date.now()): ReticulumSidecarStderrLogDecision {
    if (!text.includes(TCP_READ_ERROR_MARKER)) {
      return { level: 'warn', message: text };
    }
    const idMatch = INTERFACE_ID_RE.exec(text);
    const interfaceId = idMatch?.[1] ? Number.parseInt(idMatch[1], 10) : null;
    if (interfaceId == null || !Number.isFinite(interfaceId)) {
      return { level: 'warn', message: text };
    }
    const window = this.windows.get(interfaceId);
    if (window && nowMs - window.lastWarnAt < TCP_READ_ERROR_WARN_INTERVAL_MS) {
      window.suppressed += 1;
      return { level: 'debug', message: text };
    }
    const name = this.resolveName?.(interfaceId);
    let message = name ? `${text} name=${name}` : text;
    if (window && window.suppressed > 0) {
      message += ` (suppressed ${window.suppressed} similar TCP read errors for interface_id=${interfaceId})`;
    }
    this.windows.set(interfaceId, { lastWarnAt: nowMs, suppressed: 0 });
    return { level: 'warn', message };
  }

  /** Sidecar `interface_id`s are per process; call on each spawn. */
  reset(): void {
    this.windows.clear();
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
  const suppressed = decision.level === 'debug' && isReticulumSidecarAutoBeaconTxFailure(text);
  tracker?.recordFailure(text, suppressed, at);
  if (decision.level === 'warn') {
    sinks.warn(decision.message);
  } else {
    sinks.debug(decision.message);
  }
}
