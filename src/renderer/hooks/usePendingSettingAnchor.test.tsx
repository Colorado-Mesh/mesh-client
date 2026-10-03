import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_ANCHOR_QUERY_TIMEOUT_MS } from '@/renderer/lib/settingsAnchor';

import { type PendingSettingAnchor, usePendingSettingAnchor } from './usePendingSettingAnchor';

let frames: FrameRequestCallback[] = [];
let now = 0;

function runFrame(advanceMs = 16): void {
  now += advanceMs;
  const pending = frames;
  frames = [];
  act(() => {
    for (const cb of pending) cb(now);
  });
}

function renderAnchorHook(anchor: PendingSettingAnchor | null) {
  const onRevealed = vi.fn();
  const onTimedOut = vi.fn();
  const onCleared = vi.fn();
  const hook = renderHook(
    ({ a }: { a: PendingSettingAnchor | null }) => {
      usePendingSettingAnchor({ anchor: a, animate: false, onRevealed, onTimedOut, onCleared });
    },
    { initialProps: { a: anchor } },
  );
  return { ...hook, onRevealed, onTimedOut, onCleared };
}

describe('usePendingSettingAnchor', () => {
  beforeEach(() => {
    frames = [];
    now = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames = [];
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '<div id="panel-3"></div>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('does nothing without a pending anchor', () => {
    const { onRevealed, onCleared } = renderAnchorHook(null);
    expect(frames).toHaveLength(0);
    expect(onRevealed).not.toHaveBeenCalled();
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('reveals on the first frame when the anchor is already mounted', () => {
    document.getElementById('panel-3')!.innerHTML =
      '<div data-setting-anchor="app.gps.shareLocation"><input aria-label="x" /></div>';
    const { onRevealed, onCleared, onTimedOut } = renderAnchorHook({
      id: 'app.gps.shareLocation',
      panelIndex: 3,
    });
    runFrame();
    expect(onRevealed).toHaveBeenCalledExactlyOnceWith('app.gps.shareLocation');
    expect(onCleared).toHaveBeenCalledOnce();
    expect(onTimedOut).not.toHaveBeenCalled();
    expect(document.activeElement?.tagName).toBe('INPUT');
  });

  it('keeps retrying until a lazily mounted anchor appears', () => {
    const { onRevealed } = renderAnchorHook({ id: 'app.gps.shareLocation', panelIndex: 3 });
    runFrame();
    runFrame();
    expect(onRevealed).not.toHaveBeenCalled();
    document.getElementById('panel-3')!.innerHTML =
      '<div data-setting-anchor="app.gps.shareLocation"></div>';
    runFrame();
    expect(onRevealed).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
  });

  it('times out with the anchor when it never appears', () => {
    const anchor = { id: 'radio.lora.region', panelIndex: 3 };
    const { onRevealed, onTimedOut, onCleared } = renderAnchorHook(anchor);
    runFrame();
    runFrame(SETTING_ANCHOR_QUERY_TIMEOUT_MS);
    expect(onTimedOut).toHaveBeenCalledExactlyOnceWith(anchor);
    expect(onCleared).toHaveBeenCalledOnce();
    expect(onRevealed).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it('cancels the pending frame on unmount', () => {
    const { unmount, onCleared } = renderAnchorHook({ id: 'app.x.y', panelIndex: 3 });
    expect(frames).toHaveLength(1);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(onCleared).not.toHaveBeenCalled();
  });
});
