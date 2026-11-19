/**
 * Chat rows are ordered by when this app first received (or sent) each message, not by the
 * sender's clock: a node whose clock runs behind would otherwise land its new message far up
 * the history. The bubble still shows the sender's `timestamp`.
 *
 * `receivedAt` is that first local receipt in ms. History saved before receipt times were kept
 * has none and keeps its wire `timestamp` as the order key, so old rows do not move.
 */

import {
  clampReadWatermarkMs,
  effectiveMessageTimestampMs,
  isUnreasonablyFutureMessageTimestampMs,
} from '@/shared/messageTimestampSkew';

import { CHAT_RECEIPT_SEED_MAX_LEAD_MS } from './timeConstants';

let lastReceivedAt = 0;

/**
 * Receipt time for a message seen for the first time. Strictly increasing within a session, so
 * a backlog drained in one millisecond keeps the order the radio handed it over.
 */
export function nextChatReceivedAt(nowMs = Date.now()): number {
  lastReceivedAt = Math.max(lastReceivedAt + 1, nowMs);
  return lastReceivedAt;
}

/**
 * The clock read keys and marks are judged against: this clock, or the newest receipt when that
 * ran ahead of it. Receipts keep counting up when this clock is set back, so after a set-back they
 * are ahead of it; judged against the wall clock alone they would read as broken (never unread,
 * never a mark) until the clock caught up.
 */
export function chatReadClockMs(nowMs = Date.now()): number {
  return Math.max(nowMs, lastReceivedAt);
}

/**
 * A receipt read back from storage. After a restart the receipt clock resumes after the newest
 * one, so lines that arrive while this clock is still set back sort after the lines saved before
 * it, as they would have in the same session. A receipt more than
 * {@link CHAT_RECEIPT_SEED_MAX_LEAD_MS} ahead is ignored: new lines then take this clock.
 */
export function observeSavedChatReceivedAt(
  receivedAt: number | null | undefined,
  nowMs = Date.now(),
): void {
  if (receivedAt == null || !Number.isFinite(receivedAt) || receivedAt <= 0) return;
  if (receivedAt > nowMs + CHAT_RECEIPT_SEED_MAX_LEAD_MS) return;
  if (receivedAt > lastReceivedAt) lastReceivedAt = receivedAt;
}

/** Cap a read mark like any mark, measured from the read clock. */
export function clampChatReadMarkMs(markMs: number, nowMs = Date.now()): number {
  return clampReadWatermarkMs(markMs, chatReadClockMs(nowMs));
}

export function resetChatReceiptClockForTests(): void {
  lastReceivedAt = 0;
}

export interface ChatReceiveOrderFields {
  receivedAt?: number;
  timestamp: number;
}

/** The order key: local receipt time, or the wire time for rows saved before receipts were kept. */
export function chatReceivedAtMs(message: ChatReceiveOrderFields): number {
  return message.receivedAt ?? message.timestamp;
}

/**
 * True when the sender's clock put the message on another calendar day than it arrived here. The
 * bubble then shows the sender's date with its time, since the day separator above it is the
 * arrival day.
 */
export function chatSentOnAnotherDay(message: ChatReceiveOrderFields): boolean {
  if (message.receivedAt == null) return false;
  const sent = new Date(message.timestamp);
  const received = new Date(message.receivedAt);
  return (
    sent.getFullYear() !== received.getFullYear() ||
    sent.getMonth() !== received.getMonth() ||
    sent.getDate() !== received.getDate()
  );
}

/** Earlier of two receipt times; a later sighting of the same message never moves it down. */
export function earliestChatReceivedAt(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/**
 * The key read marks use (unread counts, the unread divider, Mark unread and the mark itself): the
 * order key, treated like a wire time, so a key far ahead of the read clock reads as now.
 */
export function chatReadOrderMs(message: ChatReceiveOrderFields, nowMs = Date.now()): number {
  return effectiveMessageTimestampMs(chatReceivedAtMs(message), chatReadClockMs(nowMs));
}

/**
 * True when the order key is too far ahead to trust. Such a row never counts as unread and never
 * sets a read mark.
 * - A receipt is this app's own clock, so any receipt above the read clock is broken: one saved
 *   before this clock was set back by more than a day (see {@link observeSavedChatReceivedAt}).
 * - A sender stamp (rows saved before receipts were kept) gets the usual five minutes over this
 *   clock, and is also usable up to the read clock; it never gets five minutes over receipts that
 *   ran ahead, or it would set a mark above the next receipt.
 * `nowMs` is this clock, never the read clock.
 */
export function isChatReadOrderPoisoned(
  message: ChatReceiveOrderFields,
  nowMs = Date.now(),
): boolean {
  const readNow = chatReadClockMs(nowMs);
  if (message.receivedAt != null) return message.receivedAt > readNow;
  return (
    isUnreasonablyFutureMessageTimestampMs(message.timestamp, nowMs) && message.timestamp > readNow
  );
}

/**
 * Catch up's "since last read" key for a loaded line: its read key, or 0 for a row the unread
 * counts and the divider skip, so it is never summarized as unread either.
 */
export function chatSummaryOrderMs(message: ChatReceiveOrderFields, nowMs = Date.now()): number {
  return isChatReadOrderPoisoned(message, nowMs) ? 0 : chatReadOrderMs(message, nowMs);
}

/** Read mark for a conversation: its newest usable read key, capped like any mark; 0 when none. */
export function latestChatReadMs(
  messages: readonly ChatReceiveOrderFields[],
  nowMs = Date.now(),
): number {
  let latest = 0;
  for (const message of messages) {
    if (isChatReadOrderPoisoned(message, nowMs)) continue;
    const at = chatReadOrderMs(message, nowMs);
    if (at > latest) latest = at;
  }
  return clampChatReadMarkMs(latest, nowMs);
}

/** Ascending receipt order; ties fall back to the wire time, then to `tieBreak`. */
export function compareChatReceiveOrder<T extends ChatReceiveOrderFields>(
  a: T,
  b: T,
  tieBreak?: (a: T, b: T) => number,
): number {
  const byReceipt = chatReceivedAtMs(a) - chatReceivedAtMs(b);
  if (byReceipt !== 0) return byReceipt;
  const byWire = a.timestamp - b.timestamp;
  if (byWire !== 0) return byWire;
  return tieBreak ? tieBreak(a, b) : 0;
}
