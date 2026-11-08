// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isMapChromeClick } from './isMapChromeClick';

describe('isMapChromeClick', () => {
  it('returns false without an original event', () => {
    expect(isMapChromeClick(undefined)).toBe(false);
  });

  it('returns true for clicks inside leaflet controls', () => {
    const control = document.createElement('div');
    control.className = 'leaflet-control';
    const button = document.createElement('button');
    control.appendChild(button);
    document.body.appendChild(control);
    expect(isMapChromeClick({ target: button } as unknown as Event)).toBe(true);
    control.remove();
  });

  it('returns false for bare map surface clicks', () => {
    const pane = document.createElement('div');
    pane.className = 'leaflet-tile-pane';
    document.body.appendChild(pane);
    expect(isMapChromeClick({ target: pane } as unknown as Event)).toBe(false);
    pane.remove();
  });
});
