/**
 * Protocol-switch latency breadcrumbs for Support {@link recordRendererTiming}.
 * Records click→urgent / click→commit / click→paint without coupling App to PerformanceObserver.
 */

import { perfSpanSync } from './perfTrace';
import { recordRendererTiming } from './rendererTimings';

export interface ProtocolSwitchTimingHandle {
  /** Call when the urgent (sync) portion of the click handler returns. */
  markUrgent(): void;
  /**
   * Call when the transition body runs (after generation check).
   * Records click→commit, then wraps `work` in `perfSpanSync('protocol-switch')`.
   */
  markCommit(work: () => void): void;
}

/** Begin a switch span; schedules a double-rAF paint sample from click time. */
export function beginProtocolSwitchTiming(): ProtocolSwitchTimingHandle {
  const clickAt = performance.now();
  let paintScheduled = false;

  const schedulePaint = () => {
    if (paintScheduled) return;
    paintScheduled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recordRendererTiming('protocolSwitch:paint', Math.round(performance.now() - clickAt));
      });
    });
  };

  return {
    markUrgent() {
      recordRendererTiming('protocolSwitch:urgent', Math.round(performance.now() - clickAt));
      schedulePaint();
    },
    markCommit(work) {
      recordRendererTiming('protocolSwitch:commit', Math.round(performance.now() - clickAt));
      perfSpanSync('protocol-switch', work);
      schedulePaint();
    },
  };
}
