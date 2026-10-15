// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { selectSummaryMessages } from './aiSummaryScope';
import {
  loadPersistedRrcLastRead,
  mergeRrcReadWatermark,
  openingRrcReadWatermark,
  rrcReadKey,
  snapshotRrcReadWatermark,
} from './rrcReadWatermark';

describe('AI summary scope and RRC read boundaries', () => {
  const messages = [
    { at: 1, sender: 'A', body: 'old' },
    { at: 3600001, sender: 'B', body: 'new' },
  ];
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
  it('uses live unread count when no persistent watermark exists and clamps future timestamps', () => {
    localStorage.clear();
    const hub = 'cd'.repeat(16);
    snapshotRrcReadWatermark(hub, 'room', 1, [{ timestamp: 100 }, { timestamp: 200 }]);
    expect(openingRrcReadWatermark(hub, 'room')).toBe(199);
    mergeRrcReadWatermark(hub, 'room', Date.now() + 1e12);
    expect(loadPersistedRrcLastRead()[rrcReadKey(hub, 'room')]).toBeLessThanOrEqual(
      Date.now() + 300000,
    );
  });
});
