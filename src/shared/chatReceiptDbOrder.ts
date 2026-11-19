import { CHAT_RECEIPT_SEED_MAX_LEAD_MS } from './timeConstants';

/** Main-process bound for receipts used in chat ORDER BY (matches renderer observeSavedChatReceivedAt). */
export function maxQueryableChatReceiptMs(atMs = Date.now()): number {
  return atMs + CHAT_RECEIPT_SEED_MAX_LEAD_MS;
}

/** SQLite order key: valid receipt, else wire `timestamp` (future receipts fall back like NULL). */
export const SQL_CHAT_RECEIPT_ORDER_MS =
  'COALESCE(CASE WHEN received_at IS NOT NULL AND received_at <= @max_receipt THEN received_at END, timestamp)';