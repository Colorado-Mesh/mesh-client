// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { maxQueryableChatReceiptMs, SQL_CHAT_RECEIPT_ORDER_MS } from '../shared/chatReceiptDbOrder';
import { CHAT_RECEIPT_SEED_MAX_LEAD_MS } from '../shared/timeConstants';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { selectMeshcoreMessagesForHydration } from './meshcoreHydrationSelect';

describe('SQL_CHAT_RECEIPT_ORDER_MS', () => {
  const NOW = 1_700_000_000_000;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ranks a fresh receipt above a far-future poisoned one for LIMIT windows', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    try {
      const insert = db.prepareOnce(
        'INSERT INTO meshcore_messages (sender_id, payload, channel_idx, timestamp, received_at) VALUES (1, ?, 0, ?, ?)',
      );
      insert.run('poisoned', 1_000, NOW + CHAT_RECEIPT_SEED_MAX_LEAD_MS + 60_000);
      insert.run('fresh', NOW - 60_000, NOW - 1_000);

      const windowOne = selectMeshcoreMessagesForHydration(db, {
        globalLimit: 1,
        perChannelLimit: 1,
        roomLimit: 1,
      });
      expect(windowOne.map((row) => String(row.payload))).toEqual(['fresh']);

      const windowTwo = selectMeshcoreMessagesForHydration(db, {
        globalLimit: 2,
        perChannelLimit: 2,
        roomLimit: 2,
      });
      expect(new Set(windowTwo.map((row) => String(row.payload)))).toEqual(
        new Set(['fresh', 'poisoned']),
      );

      const top = db
        .prepareOnce(
          `SELECT payload FROM meshcore_messages ORDER BY ${SQL_CHAT_RECEIPT_ORDER_MS} DESC, id DESC LIMIT @limit`,
        )
        .all({ max_receipt: maxQueryableChatReceiptMs(NOW), limit: 1 }) as { payload: string }[];
      expect(top[0]?.payload).toBe('fresh');
    } finally {
      db.close();
    }
  });
});
