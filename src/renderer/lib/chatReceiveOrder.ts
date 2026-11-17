/**
 * Chat rows are ordered by when this app first received (or sent) each message, not by the
 * sender's clock: a node whose clock runs behind would otherwise land its new message far up
 * the history. The bubble still shows the sender's `timestamp`.
 *
 * `receivedAt` is that first local receipt in ms. History saved before receipt times were kept
 * has none and keeps its wire `timestamp` as the order key, so old rows do not move.
 */

let lastReceivedAt = 0;

/**
 * Receipt time for a message seen for the first time. Strictly increasing within a session, so
 * a backlog drained in one millisecond keeps the order the radio handed it over.
 */
export function nextChatReceivedAt(nowMs = Date.now()): number {
  lastReceivedAt = Math.max(lastReceivedAt + 1, nowMs);
  return lastReceivedAt;
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
