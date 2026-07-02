import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';

import { parseChatMentionSegments } from './chatMentionSegments';
import { meshcoreMessageMatchesReplyKey } from './meshcoreChannelText';
import type { ChatMessage } from './types';

/** Pixels from latest message treated as “at bottom” (Jump to Latest, read-state, mark read). */
export const CHAT_SCROLL_END_THRESHOLD = 200;

/**
 * TanStack Virtual end-pin threshold (`wasAtEnd`, `followOnAppend`, default `isAtEnd()`).
 * Tighter than {@link CHAT_SCROLL_END_THRESHOLD} so one Windows mouse wheel notch (~60px)
 * clears the library's independent resize scroll-correction path.
 */
export const VIRTUALIZER_SCROLL_END_THRESHOLD = 30;

/** Extra virtual row height budget when the unread divider renders in that row. */
export const CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX = 40;

/** Per-URL link-preview card height budget (matches LinkPreview layout). */
export const CHAT_LINK_PREVIEW_ESTIMATE_PX = 120;
export const CHAT_LINK_PREVIEW_ESTIMATE_COMPACT_PX = 80;

export interface EstimateChatRowHeightOptions {
  compactMode?: boolean;
  unreadDividerExtra?: number;
}

/** Heuristic virtual row height for chat messages and room posts. */
export function estimateChatRowHeight(
  msg: Pick<ChatMessage, 'payload' | 'replyId' | 'replyPreviewText'> | null | undefined,
  options: EstimateChatRowHeightOptions = {},
): number {
  const compactMode = options.compactMode ?? false;
  let base = compactMode ? 56 : 96;
  if (msg?.replyId != null || msg?.replyPreviewText) {
    base += compactMode ? 40 : 72;
  }
  if ((msg?.payload.length ?? 0) > 120) {
    base += compactMode ? 24 : 48;
  }
  const urlCount = parseChatMentionSegments(msg?.payload ?? '').filter(
    (seg) => seg.kind === 'url',
  ).length;
  if (urlCount > 0) {
    base +=
      urlCount *
      (compactMode ? CHAT_LINK_PREVIEW_ESTIMATE_COMPACT_PX : CHAT_LINK_PREVIEW_ESTIMATE_PX);
  }
  return base + (options.unreadDividerExtra ?? 0);
}

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

/** Day key for grouping messages (matches ChatPanel jump-to-date). Month is 1-based. */
export function getChatDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

    const box = entry?.borderBoxSize?.[0];
    const domSize = box
      ? Math.round(box[instance.options.horizontal ? 'inlineSize' : 'blockSize'])
      : htmlEl[sizeProp];

    // A real chat row is never 0px. The ancestor tab panel goes `display:none` on
    // tab switch, which fires a 0x0 ResizeObserver entry for every rendered row;
    // caching that would corrupt the size cache while hidden and make scrollToEnd()
    // land at a wrong, variable position on return. Fall back to what we already know.
    if (domSize === 0) {
      return cached ?? estimated;
    }

    if (instance.scrollDirection === 'backward' && hasMeasuredSize) {
      // Allow growth (async previews, layout) but prevent shrink jitter while scrolling up.
      return domSize > cached ? domSize : cached;
    }

    return domSize;
  };
}

/** Re-measure a virtualized chat row after async content (e.g. link preview) changes height. */
export function scheduleVirtualRowRemeasure(
  measureElement: (node: Element) => void,
  container: HTMLElement | null,
  rowIndex: number,
): void {
  requestAnimationFrame(() => {
    const row = container?.querySelector(`[data-index="${rowIndex}"]`);
    if (row instanceof HTMLElement) {
      measureElement(row);
    }
  });
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
    instance: Pick<Virtualizer<HTMLDivElement, Element>, 'scrollDirection' | 'isAtEnd'>,
  ): boolean => {
    if (instance.scrollDirection === 'backward') return false;
    // Pin ref updates in React onScroll, after virtualizer flushSync during resizeItem.
    if (!instance.isAtEnd()) return false;
    if (item.index === deps.unreadStartIndexRef.current) return false;
    if (!deps.isPinnedToBottomRef.current) return false;
    return true;
  };
}

/** Resolve virtual index for quote-reply jump (`packetId ?? timestamp`). */
export function findMessageIndexByKey(messages: readonly ChatMessage[], key: number): number {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if ((msg.packetId ?? msg.timestamp) === key || meshcoreMessageMatchesReplyKey(msg, key)) {
      return i;
    }
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

/** TanStack virtualizer key for chat message rows (includes list index for uniqueness). */
export function getChatMessageVirtualizerKey(
  msg: Pick<ChatMessage, 'id' | 'timestamp' | 'packetId'> | null | undefined,
  index: number,
): string {
  if (!msg) return `msg-slot-${index}`;
  return msg.id != null
    ? `db-${msg.id}-${index}`
    : `${msg.timestamp}-${msg.packetId ?? 'x'}-${index}`;
}

/** Stable content key for room BBS posts (starred jump, scroll-to-row). */
export function roomPostRowKey(m: ChatMessage): string {
  return m.roomServerId != null
    ? `room:${m.roomServerId}:${Math.floor(m.timestamp / 1000)}:${m.sender_id}`
    : `${m.timestamp}:${m.sender_id}:${m.payload}`;
}

/** Virtualizer key for room posts — appends index so same-second posts do not collide. */
export function roomPostVirtualizerKey(m: ChatMessage, index: number): string {
  return `${roomPostRowKey(m)}-${index}`;
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
