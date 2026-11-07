import { Virtualizer } from '@tanstack/react-virtual';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStableChatMeasureElement } from '@/renderer/lib/chatScrollUtils';

import { useDropStaleDividerRowSize } from './useDropStaleDividerRowSize';

const LINE_PX = 18;
const DIVIDER_PX = 38;
const ESTIMATE_PX = 22;
const DIVIDER_ESTIMATE_PX = 40;

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let unreadStartIndex = 0;
  const estimateSize = (index: number) =>
    ESTIMATE_PX + (index === unreadStartIndex ? DIVIDER_ESTIMATE_PX : 0);
  const rowKey = (index: number) => `line-${index}`;
  let reportScroll: ((offset: number, isScrolling: boolean) => void) | undefined;
  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: 3,
    getScrollElement: () => container,
    estimateSize,
    getItemKey: rowKey,
    scrollToFn: () => {},
    observeElementRect: () => {},
    observeElementOffset: (_instance, cb) => {
      reportScroll = cb;
    },
    measureElement: createStableChatMeasureElement(estimateSize),
  });
  const unmount = virtualizer._didMount();
  virtualizer._willUpdate();
  virtualizer.getVirtualItems();

  const row = (index: number, height: number) => {
    const element = document.createElement('div');
    element.dataset.index = String(index);
    Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
    return element;
  };
  // What a ResizeObserver entry does for a row that has just mounted.
  const observe = (element: HTMLElement) => {
    virtualizer.resizeItem(
      virtualizer.indexFromElement(element),
      virtualizer.options.measureElement(element, undefined, virtualizer),
    );
  };

  const firstRow = row(0, LINE_PX + DIVIDER_PX);
  container.append(firstRow, row(1, LINE_PX), row(2, LINE_PX));
  container.querySelectorAll('[data-index]').forEach((element) => {
    observe(element as HTMLElement);
  });

  const hook = renderHook(
    ({ unread }: { unread: number }) => {
      useDropStaleDividerRowSize({
        unreadStartIndex: unread,
        count: 3,
        rowKey,
        estimateSize,
        virtualizerRef: { current: virtualizer },
        containerRef: { current: container },
      });
    },
    { initialProps: { unread: unreadStartIndex } },
  );

  return {
    container,
    firstRow,
    virtualizer,
    hook,
    row,
    observe,
    clearDivider() {
      unreadStartIndex = -1;
      hook.rerender({ unread: -1 });
    },
    scrollUp() {
      reportScroll?.(100, true);
      reportScroll?.(50, true);
    },
    scrollDown(isScrolling: boolean) {
      reportScroll?.(100, isScrolling);
    },
    cleanup() {
      hook.unmount();
      unmount();
      container.remove();
    },
  };
}

describe('useDropStaleDividerRowSize', () => {
  let current: ReturnType<typeof setup> | null = null;

  afterEach(() => {
    current?.cleanup();
    current = null;
    vi.unstubAllGlobals();
  });

  function captureFrames() {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    return () => frames.shift()?.(0);
  }

  it('measures the old divider row fresh when it comes back on screen while scrolling up', async () => {
    current = setup();
    const { container, firstRow, virtualizer, row, observe } = current;
    expect(virtualizer.getTotalSize()).toBe(LINE_PX + DIVIDER_PX + 2 * LINE_PX);

    // The reader catches up far below: the divider row is off screen when the divider goes.
    firstRow.remove();
    current.clearDivider();
    await Promise.resolve();

    current.scrollUp();
    expect(virtualizer.scrollDirection).toBe('backward');
    const remounted = row(0, LINE_PX);
    container.prepend(remounted);
    observe(remounted);

    expect(virtualizer.getTotalSize()).toBe(3 * LINE_PX);
  });

  // End jumps to the bottom in one step, so the divider can clear in a render where its row is
  // still in the DOM, and the row then unmounts before ResizeObserver reports the new height.
  it('reads the new height of a row still in the DOM when the divider goes', async () => {
    current = setup();
    const { container, firstRow, virtualizer, row, observe } = current;

    Object.defineProperty(firstRow, 'offsetHeight', { value: LINE_PX, configurable: true });
    current.clearDivider();
    await Promise.resolve();
    firstRow.remove();

    current.scrollUp();
    const remounted = row(0, LINE_PX);
    container.prepend(remounted);
    observe(remounted);

    expect(virtualizer.getTotalSize()).toBe(3 * LINE_PX);
  });

  // Resizing the row during an animated scroll (End, or a smooth scroll) stopped it short of
  // the bottom, even after the row had left the DOM.
  it('waits for the scroll to end, then uses the estimate for a row that has left', async () => {
    const nextFrame = captureFrames();
    current = setup();
    const { firstRow, virtualizer } = current;
    const resizeItem = vi.spyOn(virtualizer, 'resizeItem');

    current.scrollDown(true);
    Object.defineProperty(firstRow, 'offsetHeight', { value: LINE_PX, configurable: true });
    current.clearDivider();
    await Promise.resolve();
    firstRow.remove();
    nextFrame();
    expect(resizeItem).not.toHaveBeenCalled();

    current.scrollDown(false);
    nextFrame();
    expect(resizeItem).toHaveBeenCalledWith(0, ESTIMATE_PX);
  });

  it('stops waiting after about two seconds of scrolling', async () => {
    const nextFrame = captureFrames();
    current = setup();
    const resizeItem = vi.spyOn(current.virtualizer, 'resizeItem');

    current.scrollDown(true);
    current.clearDivider();
    await Promise.resolve();
    for (let frame = 0; frame < 119; frame++) nextFrame();
    expect(resizeItem).not.toHaveBeenCalled();

    nextFrame();
    expect(resizeItem).toHaveBeenCalledTimes(1);
  });

  it('reads the height of a row still rendered when the scroll ends', async () => {
    const nextFrame = captureFrames();
    current = setup();
    const { firstRow, virtualizer } = current;
    const resizeItem = vi.spyOn(virtualizer, 'resizeItem');

    current.scrollDown(true);
    Object.defineProperty(firstRow, 'offsetHeight', { value: LINE_PX, configurable: true });
    current.clearDivider();
    await Promise.resolve();
    expect(resizeItem).not.toHaveBeenCalled();

    current.scrollDown(false);
    nextFrame();
    expect(resizeItem).toHaveBeenCalledWith(0, LINE_PX);
    expect(virtualizer.getTotalSize()).toBe(3 * LINE_PX);
  });

  it('falls back to the estimate for a row in a hidden panel', async () => {
    current = setup();
    Object.defineProperty(current.firstRow, 'offsetHeight', { value: 0, configurable: true });
    const resizeItem = vi.spyOn(current.virtualizer, 'resizeItem');

    current.clearDivider();
    await Promise.resolve();

    expect(resizeItem).toHaveBeenCalledWith(0, ESTIMATE_PX);
  });
});
