import { type DragEvent, type HTMLAttributes, useLayoutEffect, useRef } from 'react';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { ChatOrderSide } from './useChatOrder';

/** Private drag type: a dropped chip never inserts text into the composer or another app. */
export const CHIP_ORDER_DRAG_TYPE = 'application/x-mesh-client-chip-order';

interface Options {
  /**
   * The order the chips belong to (protocol and radio). A drag that started under another scope
   * is refused, so a radio switch mid-drag cannot save into the new radio's order.
   */
  scope?: string;
  /** Chips that may be dragged and dropped onto. Other chips are left alone. */
  canMove: (id: string) => boolean;
  /** Called once per drop; the caller saves the new order and returns true when it changed. */
  onMove: (id: string, target: string, side: ChatOrderSide) => boolean | undefined;
}

interface DragState {
  id: string;
  scope: string;
  source: HTMLElement;
  target: HTMLElement | null;
  hadFocus: boolean;
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
> & { 'data-chip-order-id'?: string };

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
export function useChipDragReorder({ scope = '', canMove, onMove }: Options) {
  const drag = useRef<DragState | null>(null);
  // A drop re-renders the chips and can remount the moved one, which drops its focus.
  const refocus = useRef<{ id: string; root: HTMLElement } | null>(null);

  useLayoutEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    const active = document.activeElement;
    // Only put focus back if it was lost; never take it from something the user moved it to.
    if (active && active !== document.body && active.isConnected) return;
    for (const chip of pending.root.querySelectorAll<HTMLElement>('[data-chip-order-id]')) {
      if (chip.dataset.chipOrderId === pending.id) {
        chip.focus();
        return;
      }
    }
  });

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
    if (current.scope !== scope) {
      finish();
      return;
    }
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
      'data-chip-order-id': id,
      onDragStart: (event) => {
        finish();
        refocus.current = null;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(CHIP_ORDER_DRAG_TYPE, id);
        event.currentTarget.dataset.chipDragging = 'true';
        drag.current = {
          id,
          scope,
          source: event.currentTarget,
          target: null,
          hadFocus: document.activeElement === event.currentTarget,
        };
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
        if (current.scope !== scope) {
          finish();
          return;
        }
        event.preventDefault();
        const side = dropSide(event);
        const moved = current.id;
        const root = event.currentTarget.parentElement;
        finish();
        try {
          if (onMove(moved, id, side) && current.hadFocus && root) {
            refocus.current = { id: moved, root };
          }
        } catch (error) {
          console.warn('mcL0740 [useChipDragReorder] move failed ' + errLikeToLogString(error));
        }
      },
      onDragEnd: finish,
    };
  };
}
