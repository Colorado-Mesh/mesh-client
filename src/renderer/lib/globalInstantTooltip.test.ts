/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { findInstantTooltipHost } from './globalInstantTooltip';
import { computeInstantTooltipPosition } from './instantTooltipPosition';

describe('instantTooltipPosition', () => {
  it('clamps left near the right viewport edge', () => {
    const pos = computeInstantTooltipPosition({
      top: 200,
      bottom: 216,
      left: 1000,
      right: 1016,
      width: 16,
      height: 16,
      x: 1000,
      y: 200,
      toJSON: () => ({}),
    });
    expect(pos.left).toBeLessThanOrEqual(window.innerWidth - 128 - 8);
  });

  it('flips below when the trigger is near the top', () => {
    const pos = computeInstantTooltipPosition({
      top: 20,
      bottom: 36,
      left: 200,
      right: 216,
      width: 16,
      height: 16,
      x: 200,
      y: 20,
      toJSON: () => ({}),
    });
    expect(pos.top).toBe(40);
    expect(pos.below).toBe(true);
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
