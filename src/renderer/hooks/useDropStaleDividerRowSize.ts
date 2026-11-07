import type { Virtualizer } from '@tanstack/react-virtual';
import { type RefObject, useLayoutEffect, useRef } from 'react';

type RowKey = ReturnType<Virtualizer<HTMLDivElement, Element>['options']['getItemKey']>;

/** About two seconds at 60 frames per second; after that the rows are resized anyway. */
const MAX_WAIT_FRAMES = 120;
/** Old divider rows kept until they are found in the list again; the oldest is dropped first. */
const MAX_PENDING_ROWS = 8;

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
 *
 * The row is found by key when it is sized, so rows shifting during the wait are fine. A row
 * that is not in the list then (the reader switched conversations) stays pending and is sized
 * when it shows up again, because cached sizes outlive a conversation switch.
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
  const pendingRef = useRef(new Set<RowKey>());
  const waitingRef = useRef(false);
  const latestRef = useRef({ count, rowKey, estimateSize });

  useLayoutEffect(() => {
    latestRef.current = { count, rowKey, estimateSize };
  }, [count, rowKey, estimateSize]);

  useLayoutEffect(() => {
    const previous = dividerKeyRef.current;
    const next = unreadStartIndex >= 0 ? rowKey(unreadStartIndex) : null;
    dividerKeyRef.current = next;
    const pending = pendingRef.current;
    if (previous !== null && previous !== next) {
      pending.add(previous);
      if (pending.size > MAX_PENDING_ROWS) {
        const oldest = pending.values().next();
        if (!oldest.done) pending.delete(oldest.value);
      }
    }
    if (pending.size === 0 || waitingRef.current) return;
    waitingRef.current = true;

    const resizePending = (frame: number) => {
      const virtualizer = virtualizerRef.current;
      if (virtualizer.isScrolling && frame < MAX_WAIT_FRAMES) {
        requestAnimationFrame(() => {
          resizePending(frame + 1);
        });
        return;
      }
      waitingRef.current = false;
      const container = containerRef.current;
      if (!container) return;
      const latest = latestRef.current;
      for (let i = 0; i < latest.count && pending.size > 0; i++) {
        if (!pending.delete(latest.rowKey(i))) continue;
        const row = container.querySelector<HTMLElement>(`[data-index="${i}"]`);
        // 0 means its panel is hidden: use the estimate, and it is measured once shown.
        const height = row?.offsetHeight ?? 0;
        virtualizer.resizeItem(i, height > 0 ? height : latest.estimateSize(i));
      }
    };
    // resizeItem may flush a render, which React refuses during a commit.
    queueMicrotask(() => {
      resizePending(0);
    });
  }, [unreadStartIndex, rowKey, virtualizerRef, containerRef]);
}
