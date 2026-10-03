import { useEffect, useRef } from 'react';

import { readReduceMotion } from '@/renderer/lib/reduceMotionPreference';
import {
  revealSettingAnchor,
  SETTING_ANCHOR_QUERY_TIMEOUT_MS,
} from '@/renderer/lib/settingsAnchor';

export interface PendingSettingAnchor {
  id: string;
  panelIndex: number;
}

export interface UsePendingSettingAnchorOptions {
  anchor: PendingSettingAnchor | null;
  /** Smooth scroll; defaults to the inverse of App > Appearance > Reduce motion. */
  animate?: boolean;
  /** Called once when the anchor is found and revealed (drive the a11y announcement). */
  onRevealed: (id: string) => void;
  /**
   * Called when the anchor never appeared within the retry window, e.g. a row the panel only
   * renders while a radio is connected. The panel itself is already open.
   */
  onTimedOut: (anchor: PendingSettingAnchor) => void;
  /** Called after success or timeout, so the caller can drop the pending target. */
  onCleared: () => void;
}

/**
 * Reveals a settings-search target after the owning panel opens. Panels mount lazily behind
 * Suspense, so the lookup retries each animation frame for up to SETTING_ANCHOR_QUERY_TIMEOUT_MS.
 * Declare it after App's tab-change `scrollTop = 0` effect so that reset cannot undo the jump.
 */
export function usePendingSettingAnchor(options: UsePendingSettingAnchorOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const id = options.anchor?.id;
  const panelIndex = options.anchor?.panelIndex;

  useEffect(() => {
    if (id === undefined || panelIndex === undefined) return;
    const startedAt = performance.now();
    let frame = 0;
    const tick = () => {
      const current = optionsRef.current;
      const animate = current.animate ?? !readReduceMotion();
      if (revealSettingAnchor(id, { panelIndex, focusFirstControl: true, animate })) {
        current.onRevealed(id);
        current.onCleared();
        return;
      }
      if (performance.now() - startedAt >= SETTING_ANCHOR_QUERY_TIMEOUT_MS) {
        current.onTimedOut({ id, panelIndex });
        current.onCleared();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [id, panelIndex]);
}
