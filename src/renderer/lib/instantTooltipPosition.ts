export const INSTANT_TOOLTIP_MARGIN = 8;
const SIDE_GAP = 8;

/**
 * `auto` sits above the trigger, or below it near the top of the window. `right` sits beside it,
 * for a column of controls (the app rail) where a bubble above or below would cover a neighbour.
 */
export type InstantTooltipSide = 'auto' | 'right';

export interface InstantTooltipPosition {
  top: number;
  /** The trigger's centre for above and below; the bubble's left edge for right. */
  left: number;
  placement: 'above' | 'below' | 'right';
}

/** Fixed-position anchor for the shared instant tooltip bubble. */
export function computeInstantTooltipPosition(
  rect: DOMRect,
  side: InstantTooltipSide = 'auto',
): InstantTooltipPosition {
  if (side === 'right') {
    return { top: rect.top + rect.height / 2, left: rect.right + SIDE_GAP, placement: 'right' };
  }
  const below = rect.top < 80;
  return {
    top: below ? rect.bottom + 4 : rect.top - 8,
    left: rect.left + rect.width / 2,
    placement: below ? 'below' : 'above',
  };
}

/**
 * Left edge for a bubble of `width` centred on `center`, kept `INSTANT_TOOLTIP_MARGIN` inside the
 * viewport. The bubble is as wide as its text, so this runs once it has been measured.
 */
export function clampCenteredTooltipLeft(
  center: number,
  width: number,
  viewportWidth: number,
): number {
  const maxLeft = viewportWidth - INSTANT_TOOLTIP_MARGIN - width;
  return Math.max(INSTANT_TOOLTIP_MARGIN, Math.min(maxLeft, center - width / 2));
}
