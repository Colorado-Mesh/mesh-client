/**
 * `received_at` on the chat message tables: when this app first received (or sent) the row, in
 * ms. Chat is ordered by it; `timestamp` stays the sender's time. NULL on rows saved before
 * receipt times were kept, which keep their wire time as the order key.
 *
 * It is written once, when a row is first inserted; later saves of the same row never change it.
 * A value that is not a non-negative safe integer is stored as NULL rather than failing the save.
 */
export function chatReceivedAtForDb(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
