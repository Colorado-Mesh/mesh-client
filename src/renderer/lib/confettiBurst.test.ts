import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  burstConfetti,
  clampConfettiCount,
  clampConfettiDuration,
  isConfettiActive,
  shouldSkipConfetti,
} from './confettiBurst';

function makeFakeCtx(): CanvasRenderingContext2D {
  const noop = () => {};
  return {
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    fillRect: noop,
    beginPath: noop,
    arc: noop,
    fill: noop,
    globalAlpha: 1,
    fillStyle: '#000',
  } as unknown as CanvasRenderingContext2D;
}

describe('clampConfettiCount', () => {
  it('defaults and clamps to 10..80', () => {
    expect(clampConfettiCount(undefined)).toBe(40);
    expect(clampConfettiCount(1)).toBe(10);
    expect(clampConfettiCount(1000)).toBe(80);
    expect(clampConfettiCount(Number.NaN)).toBe(40);
    expect(clampConfettiCount(50)).toBe(50);
  });
});

describe('clampConfettiDuration', () => {
  it('defaults and clamps to 600..4000', () => {
    expect(clampConfettiDuration(undefined)).toBe(1600);
    expect(clampConfettiDuration(10)).toBe(600);
    expect(clampConfettiDuration(99999)).toBe(4000);
    expect(clampConfettiDuration(Number.NaN)).toBe(1600);
    expect(clampConfettiDuration(2000)).toBe(2000);
  });
});

describe('shouldSkipConfetti', () => {
  afterEach(() => {
    delete document.documentElement.dataset.reduceMotion;
    vi.unstubAllGlobals();
  });

  it('skips when the reduce-motion document flag is set', () => {
    document.documentElement.dataset.reduceMotion = 'true';
    expect(shouldSkipConfetti()).toBe(true);
  });

  it('skips when OS prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(shouldSkipConfetti()).toBe(true);
  });

  it('does not skip by default', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    expect(shouldSkipConfetti()).toBe(false);
  });
});

describe('burstConfetti', () => {
  let rafCb: FrameRequestCallback | null;

  beforeEach(() => {
    rafCb = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCb = cb;
        return 1;
      }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeFakeCtx());
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    // Drive any in-flight animation to completion so single-flight state resets.
    rafCb?.(1_000_000);
    rafCb = null;
    document.querySelectorAll('canvas').forEach((c) => {
      c.remove();
    });
    delete document.documentElement.dataset.reduceMotion;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('appends a canvas and starts animating', () => {
    burstConfetti({ x: 100, y: 100 });
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(isConfettiActive()).toBe(true);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('is single-flight: a second call while active is a no-op', () => {
    burstConfetti();
    burstConfetti();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('removes the canvas and clears active state when the burst ends', () => {
    burstConfetti();
    expect(isConfettiActive()).toBe(true);
    rafCb?.(1_000_000);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(isConfettiActive()).toBe(false);
  });

  it('does nothing under reduced motion', () => {
    document.documentElement.dataset.reduceMotion = 'true';
    burstConfetti();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(isConfettiActive()).toBe(false);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
