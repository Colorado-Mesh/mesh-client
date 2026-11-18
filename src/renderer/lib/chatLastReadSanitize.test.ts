import { afterEach, describe, expect, it } from 'vitest';

import {
  maxMessageTimestampByViewKey,
  maxRoomPostTimestampByServerId,
  sanitizeNumericKeyLastRead,
  sanitizeViewKeyLastRead,
} from './chatLastReadSanitize';
import { nextChatReceivedAt, resetChatReceiptClockForTests } from './chatReceiveOrder';

describe('sanitizeViewKeyLastRead', () => {
  it('clamps a future watermark down to the newest known message for that key', () => {
    const now = 1_700_000_000_000;
    const sanitized = sanitizeViewKeyLastRead(
      { 'ch:0': now + 60_000 },
      { 'ch:0': now - 60_000 },
      now,
    );
    expect(sanitized['ch:0']).toBe(now - 60_000);
  });

  it('leaves watermarks unchanged when within bounds', () => {
    const now = 1_700_000_000_000;
    const persisted = { 'ch:0': now - 5_000 };
    const sanitized = sanitizeViewKeyLastRead(persisted, { 'ch:0': now - 1_000 }, now);
    expect(sanitized).toBe(persisted);
  });

  it('ignores keys that are not ch: or dm: prefixed', () => {
    const now = 1_700_000_000_000;
    const persisted = { other: now + 60_000 };
    const sanitized = sanitizeViewKeyLastRead(persisted, {}, now);
    expect(sanitized).toBe(persisted);
  });
});

describe('sanitizeNumericKeyLastRead', () => {
  it('clamps a future watermark down to the newest known message for that room id', () => {
    const now = 1_700_000_000_000;
    const sanitized = sanitizeNumericKeyLastRead(
      { 0xabc: now + 60_000 },
      { 0xabc: now - 60_000 },
      now,
    );
    expect(sanitized[0xabc]).toBe(now - 60_000);
  });

  it('leaves watermarks unchanged when within bounds', () => {
    const now = 1_700_000_000_000;
    const persisted = { 0xabc: now - 5_000 };
    const sanitized = sanitizeNumericKeyLastRead(persisted, { 0xabc: now - 1_000 }, now);
    expect(sanitized).toBe(persisted);
  });
});

describe('maxMessageTimestampByViewKey', () => {
  it('groups by view key and keeps the newest timestamp', () => {
    const maxByKey = maxMessageTimestampByViewKey(
      [
        { sender_id: 2, to: 1, channel: 0, timestamp: 1000 },
        { sender_id: 2, to: 1, channel: 0, timestamp: 2000 },
      ],
      'meshtastic',
      new Set([1]),
    );
    expect(maxByKey['dm:2']).toBe(2000);
  });
});

describe('maxRoomPostTimestampByServerId', () => {
  it('groups by room server id and keeps the newest timestamp', () => {
    const maxById = maxRoomPostTimestampByServerId([
      { roomServerId: 0xabc, timestamp: 1000 },
      { roomServerId: 0xabc, timestamp: 2000 },
    ]);
    expect(maxById[0xabc]).toBe(2000);
  });
});

describe('read marks taken by arrival', () => {
  const now = 1_700_000_000_000;
  const HOUR = 3_600_000;

  it('keeps the newest arrival per view key, not the newest stamp', () => {
    const maxByKey = maxMessageTimestampByViewKey([
      { channel: 0, timestamp: now - 60_000, receivedAt: now - 60_000 },
      { channel: 0, timestamp: now - 2 * HOUR, receivedAt: now - 1_000 },
    ]);
    expect(maxByKey['ch:0']).toBe(now - 1_000);
  });

  it('does not lower a mark taken from a slow-clock line that was read', () => {
    const persisted = { 'ch:0': now - 1_000 };
    const maxByKey = maxMessageTimestampByViewKey([
      { channel: 0, timestamp: now - 2 * HOUR, receivedAt: now - 1_000 },
    ]);
    expect(sanitizeViewKeyLastRead(persisted, maxByKey, now)).toBe(persisted);
  });

  it('keeps the newest room post arrival, not the newest stamp', () => {
    const maxById = maxRoomPostTimestampByServerId([
      { roomServerId: 0xabc, timestamp: now - 60_000, receivedAt: now - 60_000 },
      { roomServerId: 0xabc, timestamp: now - 3 * HOUR, receivedAt: now - 1_000 },
    ]);
    expect(maxById[0xabc]).toBe(now - 1_000);
    const persisted = { [0xabc]: now - 1_000 };
    expect(sanitizeNumericKeyLastRead(persisted, maxById, now)).toBe(persisted);
  });
});

describe('read marks after this clock is set back', () => {
  const now = 1_700_000_000_000;
  const back = now - 3_600_000;

  afterEach(() => {
    resetChatReceiptClockForTests();
  });

  it('keeps a chat mark taken after the set-back, so the next line stays unread', () => {
    nextChatReceivedAt(now);
    const readAt = nextChatReceivedAt(back);
    const nextAt = nextChatReceivedAt(back + 1_000);
    const persisted = { 'ch:0': readAt, 'dm:9': readAt };
    const maxByKey = maxMessageTimestampByViewKey([
      { channel: 0, timestamp: back, receivedAt: readAt },
      { channel: 0, timestamp: back + 1_000, receivedAt: nextAt },
      { channel: 0, to: 9, timestamp: back, receivedAt: nextAt },
    ]);
    expect(maxByKey['ch:0']).toBe(nextAt);
    expect(sanitizeViewKeyLastRead(persisted, maxByKey, back)).toBe(persisted);
  });

  it('keeps a room mark taken after the set-back', () => {
    nextChatReceivedAt(now);
    const readAt = nextChatReceivedAt(back);
    const nextAt = nextChatReceivedAt(back + 1_000);
    const persisted = { [0xabc]: readAt };
    const maxById = maxRoomPostTimestampByServerId([
      { roomServerId: 0xabc, timestamp: back, receivedAt: readAt },
      { roomServerId: 0xabc, timestamp: back + 1_000, receivedAt: nextAt },
    ]);
    expect(sanitizeNumericKeyLastRead(persisted, maxById, back)).toBe(persisted);
  });

  it('still lowers a mark past the receipt clock to the newest line', () => {
    nextChatReceivedAt(now);
    const readAt = nextChatReceivedAt(back);
    const maxByKey = maxMessageTimestampByViewKey([
      { channel: 0, timestamp: back, receivedAt: readAt },
    ]);
    expect(sanitizeViewKeyLastRead({ 'ch:0': readAt + 60_000 }, maxByKey, back)['ch:0']).toBe(
      readAt,
    );
    expect(sanitizeNumericKeyLastRead({ 1: readAt + 60_000 }, { 1: readAt }, back)[1]).toBe(readAt);
  });
});
