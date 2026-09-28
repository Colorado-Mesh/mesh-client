import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollStrip } from './ScrollStrip';

function setBox(el: HTMLElement, box: { left: number; right: number }) {
  el.getBoundingClientRect = () =>
    ({
      ...box,
      top: 0,
      bottom: 28,
      width: box.right - box.left,
      height: 28,
      x: box.left,
      y: 0,
    }) as DOMRect;
}

describe('ScrollStrip', () => {
  it('turns a vertical wheel into horizontal scrolling when it overflows', () => {
    render(
      <ScrollStrip aria-label="Channels">
        <button type="button">A</button>
      </ScrollStrip>,
    );
    const strip = screen.getByRole('group', { name: 'Channels' });
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 });
    fireEvent.wheel(strip, { deltaY: 120, deltaX: 0 });
    expect(strip.scrollLeft).toBe(120);
    // Horizontal gestures are left to the browser.
    fireEvent.wheel(strip, { deltaY: 0, deltaX: 40 });
    expect(strip.scrollLeft).toBe(120);
  });

  it('scrolls only itself to reveal the active item', () => {
    const { rerender } = render(
      <ScrollStrip aria-label="Channels" activeKey={null}>
        <button type="button">A</button>
        <button type="button" data-strip-active="true">
          B
        </button>
      </ScrollStrip>,
    );
    const strip = screen.getByRole('group', { name: 'Channels' });
    setBox(strip, { left: 0, right: 300 });
    setBox(screen.getByRole('button', { name: 'B' }), { left: 400, right: 460 });
    rerender(
      <ScrollStrip aria-label="Channels" activeKey={1}>
        <button type="button">A</button>
        <button type="button" data-strip-active="true">
          B
        </button>
      </ScrollStrip>,
    );
    expect(strip.scrollLeft).toBe(168);
  });
});
