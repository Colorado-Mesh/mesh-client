import { describe, expect, it } from 'vitest';

import { chatReadOrderMs, isChatReadOrderPoisoned, latestChatReadMs } from './chatReceiveOrder';

const now = 1_700_000_000_000;
const HOUR = 3_600_000;

describe('read order key', () => {
  it('reads a message by its arrival, whatever the sender clock said', () => {
    expect(chatReadOrderMs({ timestamp: now - 2 * HOUR, receivedAt: now - 1_000 }, now)).toBe(
      now - 1_000,
    );
    expect(chatReadOrderMs({ timestamp: now + 3 * 60_000, receivedAt: now - 60_000 }, now)).toBe(
      now - 60_000,
    );
  });

  it('falls back to the stamp for rows saved before arrival times were kept', () => {
    expect(chatReadOrderMs({ timestamp: now - 5_000 }, now)).toBe(now - 5_000);
    // A saved stamp far ahead of this clock reads as now, as it always has.
    expect(chatReadOrderMs({ timestamp: now + 365 * 24 * HOUR }, now)).toBe(now);
  });

  it('treats a key far ahead of this clock as unusable', () => {
    expect(isChatReadOrderPoisoned({ timestamp: now + 24 * HOUR }, now)).toBe(true);
    // A sane arrival makes a broken stamp harmless.
    expect(
      isChatReadOrderPoisoned({ timestamp: now + 24 * HOUR, receivedAt: now - 1_000 }, now),
    ).toBe(false);
    // An arrival far ahead (this clock was stepped back) is not trusted either.
    expect(isChatReadOrderPoisoned({ timestamp: now - 1_000, receivedAt: now + HOUR }, now)).toBe(
      true,
    );
    expect(isChatReadOrderPoisoned({ timestamp: now - 1_000 }, now)).toBe(false);
  });

  it('takes the newest usable key as the read mark', () => {
    expect(
      latestChatReadMs(
        [
          { timestamp: now - 10_000, receivedAt: now - 10_000 },
          { timestamp: now - 2 * HOUR, receivedAt: now - 1_000 },
          { timestamp: now - 500, receivedAt: now + HOUR },
          { timestamp: now + 24 * HOUR },
        ],
        now,
      ),
    ).toBe(now - 1_000);
  });

  it('returns no mark when nothing is usable', () => {
    expect(latestChatReadMs([], now)).toBe(0);
    expect(latestChatReadMs([{ timestamp: now + 24 * HOUR }], now)).toBe(0);
  });
});
