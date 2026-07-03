import { MS_PER_SECOND } from '../shared/timeConstants';
import type { ReticulumSidecarAutoBeaconTracker } from './reticulumSidecarAutoBeaconTracker';

/** Sidecar stderr lines matching Reticulum AutoInterface beacon TX failures. */
const AUTO_BEACON_TX_FAILED_MARKER = 'auto: beacon TX failed';

const BEACON_FAIL_WARN_INTERVAL_MS = 60 * MS_PER_SECOND;

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
