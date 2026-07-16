import { describe, expect, it } from 'vitest';

import {
  maxMessageTimestampByViewKey,
  maxRoomPostTimestampByServerId,
  sanitizeNumericKeyLastRead,
  sanitizeViewKeyLastRead,
} from './chatLastReadSanitize';

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
