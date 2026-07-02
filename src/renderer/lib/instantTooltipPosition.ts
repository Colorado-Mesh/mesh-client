export const INSTANT_TOOLTIP_WIDTH = 256; // w-64
export const INSTANT_TOOLTIP_MARGIN = 8;

export interface InstantTooltipPosition {
  top: number;
  left: number;
  below: boolean;
}

/** Fixed-position anchor for the shared instant tooltip bubble. */
export function computeInstantTooltipPosition(rect: DOMRect): InstantTooltipPosition {
  const centeredLeft = rect.left + rect.width / 2;
  const clampedLeft = Math.max(
    INSTANT_TOOLTIP_WIDTH / 2 + INSTANT_TOOLTIP_MARGIN,
    Math.min(window.innerWidth - INSTANT_TOOLTIP_WIDTH / 2 - INSTANT_TOOLTIP_MARGIN, centeredLeft),
  );
  const below = rect.top < 80;
  return { top: below ? rect.bottom + 4 : rect.top - 8, left: clampedLeft, below };
}
