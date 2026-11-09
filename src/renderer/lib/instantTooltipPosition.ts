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
  /** `top` for the opposite side (above <-> below), used when the bubble does not fit. */
  flipTop?: number;
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
  const aboveTop = rect.top - 8;
  const belowTop = rect.bottom + 4;
  return {
    top: below ? belowTop : aboveTop,
    left: rect.left + rect.width / 2,
    placement: below ? 'below' : 'above',
    flipTop: below ? aboveTop : belowTop,
  };
}

/**
 * Side for a measured bubble: the preferred side when it fits, otherwise the side with more
 * room (a long multi-line tooltip near the top of the window opens below its trigger).
 */
export function fitInstantTooltipVertically(
  pos: InstantTooltipPosition,
  height: number,
  viewportHeight: number,
): { top: number; placement: 'above' | 'below' } | null {
  if (pos.placement === 'right' || pos.flipTop == null) return null;
  const roomAt = (placement: 'above' | 'below', top: number) =>
    placement === 'above'
      ? top - INSTANT_TOOLTIP_MARGIN
      : viewportHeight - INSTANT_TOOLTIP_MARGIN - top;
  const room = roomAt(pos.placement, pos.top);
  if (height <= room) return { top: pos.top, placement: pos.placement };
  const other = pos.placement === 'above' ? 'below' : 'above';
  return roomAt(other, pos.flipTop) > room
    ? { top: pos.flipTop, placement: other }
    : { top: pos.top, placement: pos.placement };
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
