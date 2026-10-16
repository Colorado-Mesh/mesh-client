// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { mergeSummaryMessages, selectSummaryMessages } from './aiSummaryScope';
import {
  loadPersistedRrcLastRead,
  mergeRrcReadWatermark,
  openingRrcReadWatermark,
  rrcLastReadStorageKey,
  rrcReadKey,
  snapshotRrcReadWatermark,
} from './rrcReadWatermark';

describe('AI summary scope and RRC read boundaries', () => {
  it('keeps repaired and valid read boundaries stable when storage repair cannot be written', () => {
    localStorage.clear();
    let now = 1800000000000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    localStorage.setItem(
      rrcLastReadStorageKey(),
      JSON.stringify({ past: now - 1000, future: now + 180000 }),
    );
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('read-only');
    });
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    try {
      const expected = { past: now - 1000, future: now };
      expect(loadPersistedRrcLastRead()).toEqual(expected);
      now += 1000;
      expect(loadPersistedRrcLastRead()).toEqual(expected);
      expect(write).toHaveBeenCalledOnce();
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      write.mockRestore();
      dispatch.mockRestore();
      localStorage.clear();
    }
  });

  const messages = [
    { at: 1, sender: 'A', body: 'old' },
    { at: 3600001, sender: 'B', body: 'new' },
  ];
  it.each([
    [2, 1, 2],
    [1, 2, 2],
    [2, 2, 2],
    [1, 1, 1],
    [0, 2, 2],
  ])('preserves repeated messages across %i history and %i live copies', (history, live, count) => {
    const message = { at: 1, sender: 'Alice', body: 'Morning' };
    expect(
      mergeSummaryMessages(
        Array.from({ length: history }, () => message),
        Array.from({ length: live }, () => message),
      ),
    ).toHaveLength(count);
  });

  it('does not merge distinct sender/body tuples containing colons', () => {
    const first = { at: 1, sender: 'Alice: Bob', body: 'Morning' };
    const second = { at: 1, sender: 'Alice', body: ' Bob:Morning' };
    expect(mergeSummaryMessages([first], [second])).toEqual([first, second]);
  });
  it('keeps unread exclusive, hour range inclusive and loaded unfiltered', () => {
    expect(selectSummaryMessages({ messages, scope: { kind: 'unread' }, watermark: 1 })).toEqual([
      messages[1],
    ]);
    expect(
      selectSummaryMessages({ messages, scope: { kind: 'hours', hours: 1 }, now: 3600001 }),
    ).toEqual(messages);
    expect(selectSummaryMessages({ messages, scope: { kind: 'loaded' } })).toEqual(messages);
  });
  it('normalizes room aliases, persists monotonically and preserves opening snapshot', () => {
    localStorage.clear();
    const hub = 'ab'.repeat(16);
    mergeRrcReadWatermark(hub, '#Lobby', 100);
    snapshotRrcReadWatermark(hub, 'lobby');
    mergeRrcReadWatermark(hub, 'lobby', 200);
    mergeRrcReadWatermark(hub, 'lobby', 50);
    expect(loadPersistedRrcLastRead()[rrcReadKey(hub, '#lobby')]).toBe(200);
    expect(openingRrcReadWatermark(hub, '#Lobby')).toBe(100);
  });
  it('does not turn a caught-up legacy RRC room into all unread history', () => {
    localStorage.clear();
    const hub = 'ef'.repeat(16);
    snapshotRrcReadWatermark(hub, 'room', 0, [{ timestamp: 100 }, { timestamp: 200 }]);
    expect(openingRrcReadWatermark(hub, 'room')).toBe(200);
    expect(
      selectSummaryMessages({
        messages: [{ at: 200, sender: 'A', body: 'already read' }],
        scope: { kind: 'unread' },
        watermark: openingRrcReadWatermark(hub, 'room'),
      }),
    ).toEqual([]);
  });
  it('excludes delayed historical hydration after opening an empty caught-up RRC room', () => {
    localStorage.clear();
    const hub = 'aa'.repeat(16);
    const old = Date.now() - 5000;
    snapshotRrcReadWatermark(hub, 'room', 0, []);
    mergeRrcReadWatermark(hub, 'room', old);
    expect(
      selectSummaryMessages({
        messages: [{ at: old, sender: 'A', body: 'hydrated read history' }],
        scope: { kind: 'unread' },
        watermark: openingRrcReadWatermark(hub, 'room'),
      }),
    ).toEqual([]);
  });
  it('keeps unknown partial-history unread boundaries from widening to all history', () => {
    localStorage.clear();
    const hub = 'bb'.repeat(16);
    const old = Date.now() - 10000;
    snapshotRrcReadWatermark(hub, 'room', 10, [{ timestamp: old }]);
    mergeRrcReadWatermark(hub, 'room', old);
    expect(
      selectSummaryMessages({
        messages: [{ at: old, sender: 'A', body: 'hydrated old traffic' }],
        scope: { kind: 'unread' },
        watermark: openingRrcReadWatermark(hub, 'room'),
      }),
    ).toEqual([]);
    const knownHub = 'cc'.repeat(16);
    mergeRrcReadWatermark(knownHub, 'room', old - 1000);
    snapshotRrcReadWatermark(knownHub, 'room', 10, [{ timestamp: old }]);
    expect(openingRrcReadWatermark(knownHub, 'room')).toBe(old - 1000);
  });
  it('bounds a future opening timestamp so normally timed later traffic remains eligible', () => {
    localStorage.clear();
    const hub = 'dd'.repeat(16);
    snapshotRrcReadWatermark(hub, 'room', 1, [{ timestamp: Date.now() + 1e12 }]);
    const boundary = openingRrcReadWatermark(hub, 'room');
    expect(boundary).toBeLessThanOrEqual(Date.now());
    const later = { at: Date.now() + 1, sender: 'A', body: 'new traffic' };
    expect(
      selectSummaryMessages({ messages: [later], scope: { kind: 'unread' }, watermark: boundary }),
    ).toEqual([later]);
  });
  it('uses live unread count when no persistent watermark exists and clamps future timestamps', () => {
    localStorage.clear();
    const hub = 'cd'.repeat(16);
    snapshotRrcReadWatermark(hub, 'room', 1, [{ timestamp: 100 }, { timestamp: 200 }]);
    expect(openingRrcReadWatermark(hub, 'room')).toBe(199);
    mergeRrcReadWatermark(hub, 'room', Date.now() + 1e12);
    expect(loadPersistedRrcLastRead()[rrcReadKey(hub, 'room')]).toBeLessThanOrEqual(Date.now());
  });
});
