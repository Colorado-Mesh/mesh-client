import { type DragEvent, type HTMLAttributes, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { ChatOrderSide } from './useChatOrder';

/** Private drag type: a dropped chip never inserts text into the composer or another app. */
export const CHIP_ORDER_DRAG_TYPE = 'application/x-mesh-client-chip-order';

interface Options {
  /** Chips that may be dragged and dropped onto. Other chips are left alone. */
  canMove: (id: string) => boolean;
  /** Called once per drop; the caller saves the new order. */
  onMove: (id: string, target: string, side: ChatOrderSide) => void;
}

interface DragState {
  id: string;
  source: HTMLElement;
  target: HTMLElement | null;
}

type ChipDragProps = Pick<
  HTMLAttributes<HTMLElement>,
  | 'draggable'
  | 'onDragStart'
  | 'onDragEnter'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'onDragEnd'
>;

/** Put this attribute on the chips' scroll container so a drag near its edge scrolls it. */
export const CHIP_DRAG_SCROLL_ATTRIBUTE = 'data-chip-drag-scroll';
const EDGE_PX = 24;
const EDGE_STEP_PX = 12;

/** Scrolls the chips' container a step while the pointer is near its top or bottom edge. */
function scrollNearEdge(event: DragEvent<HTMLElement>) {
  const scroller = event.currentTarget.closest<HTMLElement>(`[${CHIP_DRAG_SCROLL_ATTRIBUTE}]`);
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;
  const box = scroller.getBoundingClientRect();
  if (event.clientY < box.top + EDGE_PX) scroller.scrollTop -= EDGE_STEP_PX;
  else if (event.clientY > box.bottom - EDGE_PX) scroller.scrollTop += EDGE_STEP_PX;
}

/** True only for drags this hook started; a file or text dragged in from elsewhere is refused. */
function isChipDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(CHIP_ORDER_DRAG_TYPE);
}

function dropSide(event: DragEvent<HTMLElement>): ChatOrderSide {
  const box = event.currentTarget.getBoundingClientRect();
  const leftHalf = event.clientX < box.left + box.width / 2;
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  return leftHalf !== rtl ? 'before' : 'after';
}

/**
 * Native drag and drop for a row of chips. The browser starts a drag only after the pointer
 * moves, so a plain click still selects, and Escape cancels. Drop feedback is written to the
 * chips' `data-chip-dragging` / `data-drop-side` attributes so the parent does not re-render on
 * every pointer move. Keyboard users reorder with the Order chats dialog.
 */
export function useChipDragReorder({ canMove, onMove }: Options) {
  const drag = useRef<DragState | null>(null);

  const clearTarget = () => {
    const current = drag.current;
    if (!current?.target) return;
    delete current.target.dataset.dropSide;
    current.target = null;
  };
  const finish = () => {
    clearTarget();
    if (drag.current) delete drag.current.source.dataset.chipDragging;
    drag.current = null;
  };

  // dragenter and dragover both mark the chip: a pointer can enter a chip and stop without a
  // dragover arriving in between.
  const hover = (id: string, event: DragEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || !isChipDrag(event)) return;
    // Browsers fire dragover repeatedly while the pointer rests, so holding near an edge keeps
    // scrolling a strip that overflows.
    scrollNearEdge(event);
    if (current.id === id) {
      clearTarget();
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (current.target !== event.currentTarget) {
      clearTarget();
      current.target = event.currentTarget;
    }
    event.currentTarget.dataset.dropSide = dropSide(event);
  };

  return (id: string): ChipDragProps => {
    if (!canMove(id)) return {};
    return {
      draggable: true,
      onDragStart: (event) => {
        finish();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(CHIP_ORDER_DRAG_TYPE, id);
        event.currentTarget.dataset.chipDragging = 'true';
        drag.current = { id, source: event.currentTarget, target: null };
      },
      onDragEnter: (event) => {
        hover(id, event);
      },
      onDragOver: (event) => {
        hover(id, event);
      },
      onDragLeave: (event) => {
        if (drag.current?.target !== event.currentTarget) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        clearTarget();
      },
      onDrop: (event) => {
        const current = drag.current;
        if (!current || current.id === id || !isChipDrag(event)) return;
        event.preventDefault();
        const side = dropSide(event);
        const moved = current.id;
        finish();
        try {
          onMove(moved, id, side);
        } catch (error) {
          console.warn('[useChipDragReorder] move failed ' + errLikeToLogString(error));
        }
      },
      onDragEnd: finish,
    };
  };
}
