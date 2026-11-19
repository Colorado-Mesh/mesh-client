import { beforeEach, describe, expect, it } from 'vitest';

import {
  chatReadClockMs,
  chatReadOrderMs,
  chatSummaryOrderMs,
  clampChatReadMarkMs,
  isChatReadOrderPoisoned,
  latestChatReadMs,
  nextChatReceivedAt,
  observeSavedChatReceivedAt,
  resetChatReceiptClockForTests,
} from './chatReceiveOrder';
import { CHAT_RECEIPT_SEED_MAX_LEAD_MS } from './timeConstants';

const now = 1_700_000_000_000;
const HOUR = 3_600_000;

beforeEach(() => {
  resetChatReceiptClockForTests();
});

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

describe('after this clock is set back', () => {
  const back = now - HOUR;

  it('reads a receipt taken after the set-back as an arrival, not as ahead of the clock', () => {
    const before = nextChatReceivedAt(now);
    const after = nextChatReceivedAt(back);
    expect(after).toBe(before + 1);
    const line = { timestamp: back, receivedAt: after };
    expect(isChatReadOrderPoisoned(line, back)).toBe(false);
    expect(chatReadOrderMs(line, back)).toBe(after);
    expect(latestChatReadMs([{ timestamp: now, receivedAt: before }, line], back)).toBe(after);
  });

  it('keeps a mark taken from such a receipt', () => {
    nextChatReceivedAt(now);
    const after = nextChatReceivedAt(back);
    expect(chatReadClockMs(back)).toBe(after);
    expect(clampChatReadMarkMs(after, back)).toBe(after);
    // A mark past the receipt clock is still capped like any mark.
    expect(clampChatReadMarkMs(after + 2 * HOUR, back)).toBe(after + 5 * 60_000);
  });

  it('reads the wall clock when no receipt ran ahead of it', () => {
    nextChatReceivedAt(now - 5_000);
    expect(chatReadClockMs(now)).toBe(now);
    expect(clampChatReadMarkMs(now + HOUR, now)).toBe(now + 5 * 60_000);
    expect(isChatReadOrderPoisoned({ timestamp: now - 1_000, receivedAt: now + HOUR }, now)).toBe(
      true,
    );
  });
});

describe('receipts saved before a restart', () => {
  it('resumes the receipt clock after the newest saved receipt', () => {
    observeSavedChatReceivedAt(now + HOUR, now);
    expect(chatReadClockMs(now)).toBe(now + HOUR);
    expect(nextChatReceivedAt(now)).toBe(now + HOUR + 1);
    expect(isChatReadOrderPoisoned({ timestamp: now, receivedAt: now + HOUR }, now)).toBe(false);
  });

  it('ignores a saved receipt more than the seed bound ahead of this clock', () => {
    observeSavedChatReceivedAt(now + CHAT_RECEIPT_SEED_MAX_LEAD_MS + 1, now);
    expect(chatReadClockMs(now)).toBe(now);
    expect(nextChatReceivedAt(now)).toBe(now);
  });

  it('takes a saved receipt exactly at the bound', () => {
    observeSavedChatReceivedAt(now + CHAT_RECEIPT_SEED_MAX_LEAD_MS, now);
    expect(chatReadClockMs(now)).toBe(now + CHAT_RECEIPT_SEED_MAX_LEAD_MS);
  });

  it('never moves the receipt clock back and skips rows without a receipt', () => {
    observeSavedChatReceivedAt(now + HOUR, now);
    observeSavedChatReceivedAt(now + 1_000, now);
    observeSavedChatReceivedAt(undefined, now);
    observeSavedChatReceivedAt(null, now);
    observeSavedChatReceivedAt(Number.NaN, now);
    observeSavedChatReceivedAt(-5, now);
    expect(chatReadClockMs(now)).toBe(now + HOUR);
  });

  it('bounds the seed by one day', () => {
    expect(CHAT_RECEIPT_SEED_MAX_LEAD_MS).toBe(24 * HOUR);
  });
});

describe('keys ahead of the read clock', () => {
  const FIVE_MINUTES = 5 * 60_000;

  // A sender stamp gets five minutes over this clock, not five minutes over receipts that ran
  // ahead of it: such a stamp would set a mark above the next receipt and hide that line.
  it('gives a row without a receipt five minutes over this clock, not over the receipt clock', () => {
    observeSavedChatReceivedAt(now + HOUR, now);
    const stamped = { timestamp: now + HOUR + 4 * 60_000 };
    expect(isChatReadOrderPoisoned(stamped, now)).toBe(true);
    const mark = latestChatReadMs([{ timestamp: now, receivedAt: now + HOUR }, stamped], now);
    expect(mark).toBe(now + HOUR);
    expect(nextChatReceivedAt(now)).toBeGreaterThan(mark);
    // Up to five minutes over this clock, or up to the receipt clock, a stamp is still usable.
    expect(isChatReadOrderPoisoned({ timestamp: now + FIVE_MINUTES }, now)).toBe(false);
    expect(isChatReadOrderPoisoned({ timestamp: now + HOUR }, now)).toBe(false);
  });

  // Catch up "since last read" picks live lines by this key; a row the badges and the divider
  // skip must not be summarized as unread either.
  it('gives Catch up no unread key for a row the unread counts skip', () => {
    expect(chatSummaryOrderMs({ timestamp: now - 1_000, receivedAt: now + HOUR }, now)).toBe(0);
    expect(chatSummaryOrderMs({ timestamp: now + 24 * HOUR }, now)).toBe(0);
    expect(chatSummaryOrderMs({ timestamp: now - 2 * HOUR, receivedAt: now - 1_000 }, now)).toBe(
      now - 1_000,
    );
    expect(chatSummaryOrderMs({ timestamp: now - 5_000 }, now)).toBe(now - 5_000);
  });

  // Every receipt this app keeps is at or under the receipt clock; one above it was refused as a
  // seed, and the five minutes a sender stamp gets must not let it set a mark.
  it('never takes a receipt above the receipt clock as a read key', () => {
    observeSavedChatReceivedAt(now + CHAT_RECEIPT_SEED_MAX_LEAD_MS, now);
    const refused = now + CHAT_RECEIPT_SEED_MAX_LEAD_MS + 2 * 60_000;
    observeSavedChatReceivedAt(refused, now);
    const row = { timestamp: now, receivedAt: refused };
    expect(isChatReadOrderPoisoned(row, now)).toBe(true);
    expect(latestChatReadMs([row], now)).toBe(0);
    // With no receipt ahead of this clock, a receipt minutes ahead of it is refused the same way.
    resetChatReceiptClockForTests();
    expect(isChatReadOrderPoisoned({ timestamp: now, receivedAt: now + 2 * 60_000 }, now)).toBe(
      true,
    );
    expect(isChatReadOrderPoisoned({ timestamp: now, receivedAt: now }, now)).toBe(false);
  });
});
