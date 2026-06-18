import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_LINK_PREVIEW_ESTIMATE_PX,
  CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX,
  createStableChatMeasureElement,
  estimateChatRowHeight,
  findFirstMessageIndexByDayKey,
  findIndexByRowKey,
  findMessageIndexByKey,
  getChatDayKey,
  scrollElementWithinContainer,
} from './chatScrollUtils';
import type { ChatMessage } from './types';

function makeMsg(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'timestamp'>): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'Alice',
    payload: 'hello',
    channel: 0,
    status: 'acked',
    ...overrides,
  };
}

function mockMeasureInstance(
  overrides: Partial<{
    scrollDirection: 'forward' | 'backward' | null;
    cachedSize: number;
    index: number;
    key: string;
  }> = {},
) {
  const index = overrides.index ?? 0;
  const key = overrides.key ?? 'k0';
  return {
    indexFromElement: () => index,
    scrollDirection: overrides.scrollDirection ?? null,
    measurementsCache: [{ size: overrides.cachedSize ?? 80 }],
    itemSizeCache: new Map<string, number>([[key, overrides.cachedSize ?? 80]]),
    options: {
      getItemKey: () => key,
      horizontal: false,
      estimateSize: () => 96,
    },
  };
}

describe('getChatDayKey', () => {
  it('uses 1-based calendar month (June is 6, not zero-based 5)', () => {
    const ts = new Date(2026, 5, 15, 23, 59).getTime();
    expect(getChatDayKey(ts)).toBe('2026-6-15');
  });
});

describe('findMessageIndexByKey', () => {
  it('finds by packetId first', () => {
    const messages = [
      makeMsg({ timestamp: 100, packetId: 42 }),
      makeMsg({ timestamp: 200, packetId: 99 }),
    ];
    expect(findMessageIndexByKey(messages, 99)).toBe(1);
  });

  it('falls back to timestamp', () => {
    const messages = [makeMsg({ timestamp: 12345 })];
    expect(findMessageIndexByKey(messages, 12345)).toBe(0);
  });
});

describe('findFirstMessageIndexByDayKey', () => {
  it('returns first matching day', () => {
    const day = getChatDayKey(new Date(2026, 0, 10, 12).getTime());
    const messages = [
      makeMsg({ timestamp: new Date(2026, 0, 9).getTime() }),
      makeMsg({ timestamp: new Date(2026, 0, 10, 8).getTime() }),
      makeMsg({ timestamp: new Date(2026, 0, 10, 20).getTime() }),
    ];
    expect(findFirstMessageIndexByDayKey(messages, day)).toBe(1);
  });
});

describe('findIndexByRowKey', () => {
  it('finds item by custom row key', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(findIndexByRowKey(items, 'b', (x) => x.id)).toBe(1);
  });
});

describe('createStableChatMeasureElement', () => {
  it('locks cached size when scrolling backward and DOM would shrink', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 170, configurable: true });
    const size = measure(
      el,
      undefined,
      mockMeasureInstance({ scrollDirection: 'backward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(180);
  });

  it('allows growth when scrolling backward and DOM is taller than cache', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 220, configurable: true });
    const size = measure(
      el,
      undefined,
      mockMeasureInstance({ scrollDirection: 'backward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(220);
  });

  it('measures DOM when backward cache is still an estimate', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
    const size = measure(
      el,
      undefined,
      mockMeasureInstance({ scrollDirection: 'backward', cachedSize: 96 }) as never,
    );
    expect(size).toBe(200);
  });

  it('measures DOM instead of estimate cache when not scrolling backward', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
    const size = measure(
      el,
      undefined,
      mockMeasureInstance({ scrollDirection: null, cachedSize: 96 }) as never,
    );
    expect(size).toBe(200);
  });

  it('remeasures when scrolling forward with ResizeObserver entry', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 200, configurable: true });
    const entry = {
      borderBoxSize: [{ blockSize: 180, inlineSize: 300 }],
    } as unknown as ResizeObserverEntry;
    const size = measure(
      el,
      entry,
      mockMeasureInstance({ scrollDirection: 'forward', cachedSize: 72 }) as never,
    );
    expect(size).toBe(180);
  });

  it('uses ResizeObserver borderBoxSize when present', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    const entry = {
      borderBoxSize: [{ blockSize: 110, inlineSize: 300 }],
    } as unknown as ResizeObserverEntry;
    const size = measure(el, entry, mockMeasureInstance({ scrollDirection: 'forward' }) as never);
    expect(size).toBe(110);
  });

  it('honors ResizeObserver growth when scrolling backward', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 96, configurable: true });
    const entry = {
      borderBoxSize: [{ blockSize: 240, inlineSize: 300 }],
    } as unknown as ResizeObserverEntry;
    const size = measure(
      el,
      entry,
      mockMeasureInstance({ scrollDirection: 'backward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(240);
  });

  it('locks ResizeObserver shrink when scrolling backward', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    const entry = {
      borderBoxSize: [{ blockSize: 160, inlineSize: 300 }],
    } as unknown as ResizeObserverEntry;
    const size = measure(
      el,
      entry,
      mockMeasureInstance({ scrollDirection: 'backward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(180);
  });

  it('ignores a 0px offsetHeight (ancestor display:none) and keeps the cached size', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 0, configurable: true });
    const size = measure(
      el,
      undefined,
      mockMeasureInstance({ scrollDirection: 'forward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(180);
  });

  it('ignores a 0px ResizeObserver entry (ancestor display:none) and keeps the cached size', () => {
    const measure = createStableChatMeasureElement(() => 96);
    const el = document.createElement('div');
    const entry = {
      borderBoxSize: [{ blockSize: 0, inlineSize: 0 }],
    } as unknown as ResizeObserverEntry;
    const size = measure(
      el,
      entry,
      mockMeasureInstance({ scrollDirection: 'forward', cachedSize: 180 }) as never,
    );
    expect(size).toBe(180);
  });
});

describe('estimateChatRowHeight', () => {
  it('adds reply and long-payload budgets', () => {
    expect(estimateChatRowHeight(makeMsg({ timestamp: 1 }))).toBe(96);
    expect(
      estimateChatRowHeight(makeMsg({ timestamp: 1, replyId: 42, replyPreviewText: 'parent' })),
    ).toBe(168);
    expect(estimateChatRowHeight(makeMsg({ timestamp: 1, payload: 'x'.repeat(121) }))).toBe(144);
  });

  it('adds per-URL link preview budget', () => {
    const oneUrl = estimateChatRowHeight(
      makeMsg({ timestamp: 1, payload: 'see https://example.com now' }),
    );
    expect(oneUrl).toBe(96 + CHAT_LINK_PREVIEW_ESTIMATE_PX);
    const twoUrls = estimateChatRowHeight(
      makeMsg({
        timestamp: 1,
        payload: 'https://a.com and https://b.com',
      }),
    );
    expect(twoUrls).toBe(96 + CHAT_LINK_PREVIEW_ESTIMATE_PX * 2);
  });

  it('applies compact mode and unread divider extra', () => {
    expect(estimateChatRowHeight(makeMsg({ timestamp: 1 }), { compactMode: true })).toBe(56);
    expect(
      estimateChatRowHeight(makeMsg({ timestamp: 1 }), {
        unreadDividerExtra: CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX,
      }),
    ).toBe(96 + CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX);
  });
});

describe('scrollElementWithinContainer', () => {
  it('scrolls container to element start offset', () => {
    const container = document.createElement('div');
    const child = document.createElement('div');
    container.appendChild(child);
    document.body.appendChild(container);

    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTo = vi.fn();

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue({
      top: 250,
      bottom: 300,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      x: 0,
      y: 250,
      toJSON: () => ({}),
    });

    Object.defineProperty(container, 'scrollTop', {
      value: 50,
      writable: true,
      configurable: true,
    });

    scrollElementWithinContainer(container, child, 'start', 'auto');
    expect(container.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'auto' });

    document.body.removeChild(container);
  });
});
