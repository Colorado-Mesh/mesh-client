// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  revealSettingAnchor,
  SETTING_ANCHOR_FLASH_ATTR,
  SETTING_ANCHOR_FLASH_MS,
} from './settingsAnchor';

const scrollIntoView = vi.fn();

function mountPanels(html: string): void {
  document.body.innerHTML = html;
}

describe('revealSettingAnchor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('only searches inside the requested panel', () => {
    mountPanels(`
      <div id="panel-1"><div data-setting-anchor="app.x.y"><input aria-label="a" id="in-1" /></div></div>
      <div id="panel-2"><div data-setting-anchor="app.x.y"><input aria-label="b" id="in-2" /></div></div>
    `);
    expect(revealSettingAnchor('app.x.y', { panelIndex: 2, focusFirstControl: true })).toBe(true);
    expect(document.activeElement?.id).toBe('in-2');
  });

  it('returns false when the panel is hidden, missing, or the anchor sits in a hidden subtree', () => {
    mountPanels(`
      <div id="panel-1" hidden><div data-setting-anchor="app.x.y"></div></div>
      <div id="panel-2"><div hidden><div data-setting-anchor="app.x.z"></div></div></div>
    `);
    expect(revealSettingAnchor('app.x.y', { panelIndex: 1 })).toBe(false);
    expect(revealSettingAnchor('app.x.z', { panelIndex: 2 })).toBe(false);
    expect(revealSettingAnchor('app.x.y', { panelIndex: 9 })).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens collapsed details around the anchor, including the anchor itself', () => {
    mountPanels(`
      <div id="panel-0">
        <details id="outer"><summary>s</summary>
          <details id="inner" data-setting-anchor="radio.lora.region"><summary>t</summary></details>
        </details>
      </div>
    `);
    expect(revealSettingAnchor('radio.lora.region', { panelIndex: 0 })).toBe(true);
    expect((document.getElementById('outer') as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById('inner') as HTMLDetailsElement).open).toBe(true);
  });

  it('flashes the anchor and removes the flash after the timeout', () => {
    mountPanels(`<div id="panel-0"><div id="a" data-setting-anchor="app.x.y"></div></div>`);
    revealSettingAnchor('app.x.y', { panelIndex: 0 });
    const el = document.getElementById('a');
    expect(el?.hasAttribute(SETTING_ANCHOR_FLASH_ATTR)).toBe(true);
    vi.advanceTimersByTime(SETTING_ANCHOR_FLASH_MS);
    expect(el?.hasAttribute(SETTING_ANCHOR_FLASH_ATTR)).toBe(false);
  });

  it.each([
    [undefined, 'smooth'],
    [true, 'smooth'],
    [false, 'auto'],
  ] as const)('animate=%s scrolls with behavior %s', (animate, behavior) => {
    mountPanels(`<div id="panel-0"><div data-setting-anchor="app.x.y"></div></div>`);
    revealSettingAnchor('app.x.y', { panelIndex: 0, animate });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior, block: 'center' });
  });

  it('moves focus only when asked, and to the anchor itself when it is a control', () => {
    mountPanels(`
      <div id="panel-0">
        <div data-setting-anchor="app.x.wrap"><button id="btn" type="button">b</button></div>
        <select id="sel" aria-label="s" data-setting-anchor="app.x.select"></select>
      </div>
    `);
    revealSettingAnchor('app.x.wrap', { panelIndex: 0 });
    expect(document.activeElement).toBe(document.body);
    revealSettingAnchor('app.x.wrap', { panelIndex: 0, focusFirstControl: true });
    expect(document.activeElement?.id).toBe('btn');
    revealSettingAnchor('app.x.select', { panelIndex: 0, focusFirstControl: true });
    expect(document.activeElement?.id).toBe('sel');
  });
});
