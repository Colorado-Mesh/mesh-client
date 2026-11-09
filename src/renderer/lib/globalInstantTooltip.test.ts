/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { findInstantTooltipHost, instantTooltipSide } from './globalInstantTooltip';
import {
  clampCenteredTooltipLeft,
  computeInstantTooltipPosition,
  fitInstantTooltipVertically,
} from './instantTooltipPosition';

function rectAt(left: number, top: number, size = 16): DOMRect {
  return {
    top,
    bottom: top + size,
    left,
    right: left + size,
    width: size,
    height: size,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('instantTooltipPosition', () => {
  it('centres above the trigger', () => {
    const pos = computeInstantTooltipPosition(rectAt(1000, 200));
    // flipTop is the below position, used when a tall bubble does not fit above.
    expect(pos).toEqual({ top: 192, left: 1008, placement: 'above', flipTop: 220 });
  });

  it('flips below when the trigger is near the top', () => {
    const pos = computeInstantTooltipPosition(rectAt(200, 20));
    expect(pos.top).toBe(40);
    expect(pos.placement).toBe('below');
    expect(pos.flipTop).toBe(12);
  });

  it('keeps a measured bubble on its side when it fits', () => {
    const pos = { top: 400, left: 300, placement: 'above' as const, flipTop: 430 };
    expect(fitInstantTooltipVertically(pos, 200, 852)).toEqual({ top: 400, placement: 'above' });
  });

  it('opens a tall bubble below a trigger near the top instead of off screen', () => {
    // A 13-line route above a pill at y=218 would start 124px above the window.
    const pos = { top: 210, left: 377, placement: 'above' as const, flipTop: 238 };
    expect(fitInstantTooltipVertically(pos, 334, 852)).toEqual({ top: 238, placement: 'below' });
  });

  it('opens a tall bubble above a trigger near the bottom', () => {
    const pos = { top: 700, left: 377, placement: 'below' as const, flipTop: 672 };
    expect(fitInstantTooltipVertically(pos, 300, 852)).toEqual({ top: 672, placement: 'above' });
  });

  it('keeps the side with more room when neither side fits', () => {
    const pos = { top: 300, left: 377, placement: 'above' as const, flipTop: 330 };
    expect(fitInstantTooltipVertically(pos, 700, 852)).toEqual({ top: 330, placement: 'below' });
    expect(fitInstantTooltipVertically({ ...pos, top: 520, flipTop: 550 }, 700, 852)).toEqual({
      top: 520,
      placement: 'above',
    });
  });

  it('leaves side and unflippable bubbles alone', () => {
    expect(fitInstantTooltipVertically({ top: 1, left: 1, placement: 'right' }, 900, 852)).toBe(
      null,
    );
    expect(fitInstantTooltipVertically({ top: 1, left: 1, placement: 'above' }, 900, 852)).toBe(
      null,
    );
  });

  it('opens beside the trigger for the right side, centred on it vertically', () => {
    const pos = computeInstantTooltipPosition(rectAt(10, 300, 40), 'right');
    expect(pos).toEqual({ top: 320, left: 58, placement: 'right' });
  });

  it('keeps a measured bubble inside the viewport', () => {
    // Near the right edge: an 80px bubble centred on x=1010 ends 8px inside a 1024px window.
    expect(clampCenteredTooltipLeft(1010, 80, 1024)).toBe(936);
    // Near the left edge it starts at the margin.
    expect(clampCenteredTooltipLeft(20, 80, 1024)).toBe(8);
    // With room, it is centred on the trigger.
    expect(clampCenteredTooltipLeft(500, 80, 1024)).toBe(460);
  });
});

describe('findInstantTooltipHost', () => {
  it('returns the nearest ancestor with a title', () => {
    document.body.innerHTML = '<button title="Outer"><span id="inner">Child</span></button>';
    const inner = document.getElementById('inner');
    expect(findInstantTooltipHost(inner)).toBe(inner?.parentElement);
    document.body.innerHTML = '';
  });

  it('skips hosts inside HelpTooltip-managed subtrees', () => {
    document.body.innerHTML =
      '<span data-instant-tooltip-managed=""><button title="Ignored">X</button></span>';
    const button = document.querySelector('button');
    expect(findInstantTooltipHost(button)).toBeNull();
    document.body.innerHTML = '';
  });
});

describe('instantTooltipSide', () => {
  it('opens to the right inside a container that asks for it', () => {
    document.body.innerHTML =
      '<nav data-tooltip-side="right"><button id="rail" title="Chat">C</button></nav><button id="other" title="Search">S</button>';
    expect(instantTooltipSide(document.getElementById('rail') as Element)).toBe('right');
    expect(instantTooltipSide(document.getElementById('other') as Element)).toBe('auto');
    document.body.innerHTML = '';
  });
});
