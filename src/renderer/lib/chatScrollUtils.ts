import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

import type { ChatMessage } from './types';

/** Pixels from latest message treated as “at bottom” (Jump to Latest, follow-on-append, mark read). */
export const CHAT_SCROLL_END_THRESHOLD = 200;

/** Extra virtual row height budget when the unread divider renders in that row. */
export const CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX = 40;

/**
 * Distance from the “bottom” of the chat (latest messages). Uses the **maximum** of:
 * - Inner `overflow-y-auto` distance when the message list overflows, and
 * - Message-end sentinel vs `outerScrollRoot` (app main viewport), so we still
 *   detect “not at latest” when the inner scroller is at max but the shell scroll
 *   has moved the thread off-screen (or vice versa).
 */
export function getDistFromChatBottom(
  inner: HTMLDivElement | null,
  messagesEnd: HTMLDivElement | null,
  outerScrollRoot: HTMLElement | null,
): number | null {
  if (!inner) return null;

  let dist = 0;

  if (inner.scrollHeight > inner.clientHeight + 1) {
    dist = Math.max(dist, inner.scrollHeight - inner.scrollTop - inner.clientHeight);
  }

  if (outerScrollRoot && messagesEnd) {
    const rootRect = outerScrollRoot.getBoundingClientRect();
    const endRect = messagesEnd.getBoundingClientRect();
    dist = Math.max(dist, Math.max(0, endRect.bottom - rootRect.bottom));
  }

  return dist;
}

/** Day key for grouping messages (matches ChatPanel jump-to-date). */
export function getChatDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Scroll an element within a scroll container without scrollIntoView (avoids outer viewport fights). */
export function scrollElementWithinContainer(
  container: HTMLElement,
  element: HTMLElement,
  align: 'start' | 'center',
  behavior: ScrollBehavior = 'auto',
): void {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const offsetTop = elementRect.top - containerRect.top + container.scrollTop;
  const targetTop =
    align === 'center'
      ? offsetTop - container.clientHeight / 2 + elementRect.height / 2
      : offsetTop;
  container.scrollTo({ top: Math.max(0, targetTop), behavior });
}

type ScrollMeasureInstance = Pick<
  Virtualizer<HTMLDivElement, Element>,
  'indexFromElement' | 'scrollDirection' | 'measurementsCache' | 'itemSizeCache' | 'options'
>;

/** TanStack measureElement that locks cached sizes while scrolling backward. */
export function createStableChatMeasureElement(
  estimateSize: (index: number) => number,
): NonNullable<Virtualizer<HTMLDivElement, Element>['options']['measureElement']> {
  return (element, entry, instance: ScrollMeasureInstance) => {
    const index = instance.indexFromElement(element);
    const htmlEl = element as HTMLElement;
    const sizeProp = instance.options.horizontal ? 'offsetWidth' : 'offsetHeight';

    if (index < 0) {
      return htmlEl[sizeProp];
    }

    const key = instance.options.getItemKey(index);
    const estimated = estimateSize(index);
    const cached = instance.measurementsCache[index]?.size ?? instance.itemSizeCache.get(key);
    const hasMeasuredSize = cached != null && cached !== estimated;

    if (instance.scrollDirection === 'backward' && hasMeasuredSize) {
      return cached;
    }

    const box = entry?.borderBoxSize?.[0];
    if (box) {
      return Math.round(box[instance.options.horizontal ? 'inlineSize' : 'blockSize']);
    }

    return htmlEl[sizeProp];
  };
}

export interface ChatScrollAdjustDeps {
  unreadStartIndexRef: RefObject<number>;
  isPinnedToBottomRef: RefObject<boolean>;
}

/** Composes TanStack default backward guard with chat unread/pin rules. */
export function createChatScrollAdjustPredicate(deps: ChatScrollAdjustDeps) {
  return (
    item: VirtualItem,
    _delta: number,
    instance: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollDirection'>,
  ): boolean => {
    if (instance.scrollDirection === 'backward') return false;
    if (item.index === deps.unreadStartIndexRef.current) return false;
    if (!deps.isPinnedToBottomRef.current) return false;
    return true;
  };
}

/** Resolve virtual index for quote-reply jump (`packetId ?? timestamp`). */
export function findMessageIndexByKey(messages: readonly ChatMessage[], key: number): number {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if ((msg.packetId ?? msg.timestamp) === key) return i;
  }
  return -1;
}

/** First message index matching a calendar day key. */
export function findFirstMessageIndexByDayKey(
  messages: readonly ChatMessage[],
  dayKey: string,
): number {
  for (let i = 0; i < messages.length; i++) {
    if (getChatDayKey(messages[i].timestamp) === dayKey) return i;
  }
  return -1;
}

/** Generic row-key lookup for virtualized lists (e.g. room posts). */
export function findIndexByRowKey<T>(
  items: readonly T[],
  rowKey: string,
  getRowKey: (item: T) => string,
): number {
  for (let i = 0; i < items.length; i++) {
    if (getRowKey(items[i]) === rowKey) return i;
  }
  return -1;
}
