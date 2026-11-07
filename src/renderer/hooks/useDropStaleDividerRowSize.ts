import type { Virtualizer } from '@tanstack/react-virtual';
import { type RefObject, useLayoutEffect, useRef } from 'react';

type RowKey = ReturnType<Virtualizer<HTMLDivElement, Element>['options']['getItemKey']>;

/** About two seconds at 60 frames per second; after that the row is resized anyway. */
const MAX_WAIT_FRAMES = 120;

export interface DropStaleDividerRowSizeOptions {
  unreadStartIndex: number;
  count: number;
  /** The same key the virtualizer's getItemKey returns for a row. */
  rowKey: (index: number) => RowKey;
  estimateSize: (index: number) => number;
  virtualizerRef: RefObject<
    Pick<Virtualizer<HTMLDivElement, Element>, 'resizeItem' | 'isScrolling'>
  >;
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * The unread divider is drawn inside the first unread row, so that row's measured height
 * includes it. When the divider leaves a row that is off screen, nothing measures the row
 * again, and scrolling back up to it keeps the taller height (createStableChatMeasureElement
 * never shrinks a row during an upward scroll), so a gap is left where the divider was.
 *
 * So size that row again once the list stops scrolling: from its own height if it is still
 * rendered, or back to its estimate if not, which the stable measure treats as unmeasured so
 * the row is measured fresh when it mounts. A fast scroll such as End can clear the divider
 * while its row is still rendered and unmount it before ResizeObserver reports the change,
 * and resizing the row during an animated scroll stops that scroll short of the bottom.
 */
export function useDropStaleDividerRowSize({
  unreadStartIndex,
  count,
  rowKey,
  estimateSize,
  virtualizerRef,
  containerRef,
}: DropStaleDividerRowSizeOptions): void {
  const dividerKeyRef = useRef<RowKey | null>(null);
  const latestRef = useRef({ count, rowKey, estimateSize });

  useLayoutEffect(() => {
    latestRef.current = { count, rowKey, estimateSize };
  }, [count, rowKey, estimateSize]);

  useLayoutEffect(() => {
    const previous = dividerKeyRef.current;
    const next = unreadStartIndex >= 0 ? rowKey(unreadStartIndex) : null;
    dividerKeyRef.current = next;
    if (previous === null || previous === next) return;

    // Look the row up when it is sized: rows can shift while the list scrolls.
    const findRow = () => {
      const latest = latestRef.current;
      for (let i = 0; i < latest.count; i++) {
        if (latest.rowKey(i) === previous) return i;
      }
      return -1;
    };
    const resize = (frame: number) => {
      const virtualizer = virtualizerRef.current;
      if (virtualizer.isScrolling && frame < MAX_WAIT_FRAMES) {
        requestAnimationFrame(() => {
          resize(frame + 1);
        });
        return;
      }
      const container = containerRef.current;
      const found = findRow();
      if (!container || found < 0) return;
      const row = container.querySelector<HTMLElement>(`[data-index="${found}"]`);
      // 0 means its panel is hidden: use the estimate, and it is measured once shown.
      const height = row?.offsetHeight ?? 0;
      virtualizer.resizeItem(found, height > 0 ? height : latestRef.current.estimateSize(found));
    };
    // resizeItem may flush a render, which React refuses during a commit.
    queueMicrotask(() => {
      resize(0);
    });
  }, [unreadStartIndex, rowKey, virtualizerRef, containerRef]);
}
