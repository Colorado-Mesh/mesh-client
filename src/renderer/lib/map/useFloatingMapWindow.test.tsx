import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clampFloatingMapPosition, useFloatingMapWindow } from './useFloatingMapWindow';

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

let resized: () => void;
let disconnect = vi.fn<() => void>();
beforeEach(() => {
  disconnect = vi.fn<() => void>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect() {
        disconnect();
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const map = document.createElement('div');
  const window = document.createElement('aside');
  const button = document.createElement('button');
  button.setPointerCapture = vi.fn();
  button.releasePointerCapture = vi.fn();
  let mapSize = rectangle(0, 0, 800, 600);
  let windowSize = rectangle(450, 350, 320, 200);
  map.getBoundingClientRect = () => mapSize;
  window.getBoundingClientRect = () => windowSize;
  const mapRef = { current: map };
  const windowRef = { current: window };
  const view = renderHook(({ active }) => useFloatingMapWindow(mapRef, windowRef, active), {
    initialProps: { active: true },
  });
  // React applies the returned coordinates to the real floating window. Mirror that layout here
  // so a second drag starts from the resized/clamped position instead of the fixture's origin.
  window.getBoundingClientRect = () => {
    const position = view.result.current.position;
    return rectangle(
      position?.x ?? windowSize.left,
      position?.y ?? windowSize.top,
      windowSize.width,
      windowSize.height,
    );
  };
  const pointer = (x: number, y: number): PointerEvent<HTMLButtonElement> =>
    ({
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
      currentTarget: button,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as PointerEvent<HTMLButtonElement>;
  const key = (name: string, shiftKey = false): KeyboardEvent<HTMLButtonElement> =>
    ({
      key: name,
      shiftKey,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }) as unknown as KeyboardEvent<HTMLButtonElement>;
  return {
    ...view,
    window,
    button,
    pointer,
    key,
    resizeMap: (width: number, height: number) => {
      mapSize = rectangle(0, 0, width, height);
    },
    resizeWindow: (width: number, height: number) => {
      windowSize = rectangle(450, 350, width, height);
    },
  };
}

describe('floating traffic window', () => {
  it('clamps every edge, including a map smaller than the window', () => {
    expect(
      clampFloatingMapPosition(
        { x: -100, y: 900 },
        { width: 800, height: 600 },
        { width: 320, height: 200 },
      ),
    ).toEqual({ x: 12, y: 388 });
    expect(
      clampFloatingMapPosition(
        { x: 30, y: 50 },
        { width: 100, height: 100 },
        { width: 320, height: 200 },
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it('captures the pointer and moves the window without rendering the map for every move', () => {
    const view = fixture();
    act(() => {
      view.result.current.onPointerDown(view.pointer(100, 100));
    });
    expect(view.button.setPointerCapture).toHaveBeenCalledWith(1);
    act(() => {
      view.result.current.onPointerMove(view.pointer(1000, 1000));
    });
    expect(view.window.style.left).toBe('468px');
    expect(view.window.style.top).toBe('388px');
    expect(view.result.current.position).toBeNull();
    act(() => {
      view.result.current.onPointerUp(view.pointer(1000, 1000));
    });
    expect(view.result.current.position).toEqual({ x: 468, y: 388 });
    expect(view.button.releasePointerCapture).toHaveBeenCalledWith(1);
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('expands upward from its bottom anchor and restores the collapsed bar after clamping', () => {
    const view = fixture();
    act(() => {
      view.result.current.onPointerDown(view.pointer(100, 100));
    });
    act(() => {
      view.result.current.onPointerUp(view.pointer(100, 100));
    });
    // Original bottom anchor: 350 + 200 = 550.
    view.resizeWindow(320, 400);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 450, y: 150 });
    view.resizeMap(400, 300);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 68, y: 0 });
    view.resizeMap(800, 600);
    view.resizeWindow(320, 40);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 450, y: 510 });
    view.unmount();
  });

  it('restores the exact collapsed origin after expansion is clamped on both axes', () => {
    const view = fixture();
    view.resizeWindow(320, 40);
    act(() => {
      view.result.current.onPointerDown(view.pointer(100, 100));
      view.result.current.onPointerUp(view.pointer(100, 100));
    });
    expect(view.result.current.position).toEqual({ x: 450, y: 350 });
    view.resizeWindow(416, 400);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 372, y: 12 });
    view.resizeMap(400, 250);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 0, y: 0 });
    view.resizeMap(800, 600);
    view.resizeWindow(320, 40);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 450, y: 350 });
    view.unmount();
  });

  it('uses the newly dragged expanded bottom edge as the next collapsed anchor', () => {
    const view = fixture();
    view.resizeWindow(320, 40);
    act(() => {
      view.result.current.onPointerDown(view.pointer(100, 100));
      view.result.current.onPointerUp(view.pointer(100, 100));
    });
    view.resizeWindow(320, 320);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 450, y: 70 });
    act(() => {
      view.result.current.onPointerDown(view.pointer(100, 100));
    });
    act(() => {
      view.result.current.onPointerMove(view.pointer(180, 60));
    });
    act(() => {
      view.result.current.onPointerUp(view.pointer(180, 60));
    });
    expect(view.result.current.position).toEqual({ x: 468, y: 30 });
    view.resizeWindow(320, 40);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 468, y: 310 });
    view.unmount();
  });

  it('keeps keyboard moves in the dock anchor across expansion and viewport resizing', () => {
    const view = fixture();
    view.resizeWindow(320, 40);
    act(() => {
      view.result.current.onKeyDown(view.key('ArrowLeft'));
    });
    view.resizeWindow(320, 320);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 70 });
    act(() => {
      view.result.current.onKeyDown(view.key('ArrowUp', true));
    });
    view.resizeWindow(320, 40);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 320 });
    view.resizeMap(500, 300);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 168, y: 248 });
    view.resizeMap(800, 600);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 320 });
    view.unmount();
  });

  it('keeps the dragged dock anchor when navigation removes the map and resumes resize observation on return', () => {
    const view = fixture();
    act(() => {
      view.result.current.onKeyDown(view.key('ArrowLeft'));
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 350 });
    view.resizeMap(0, 0);
    view.resizeWindow(0, 0);
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 350 });
    view.rerender({ active: false });
    expect(disconnect).toHaveBeenCalled();
    view.resizeMap(800, 600);
    view.resizeWindow(320, 40);
    view.rerender({ active: true });
    act(() => {
      resized();
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 510 });
    view.unmount();
  });

  it('supports keyboard nudging, larger shifted steps, and reset to the default dock', () => {
    const view = fixture();
    act(() => {
      view.result.current.onKeyDown(view.key('ArrowLeft'));
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 350 });
    act(() => {
      view.result.current.onKeyDown(view.key('ArrowUp', true));
    });
    expect(view.result.current.position).toEqual({ x: 440, y: 320 });
    act(() => {
      view.result.current.reset();
    });
    expect(view.result.current.position).toBeNull();
    expect(view.window.style.left).toBe('');
    view.unmount();
  });
});
