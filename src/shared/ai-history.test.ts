import { describe, expect, it } from 'vitest';

import type { AiHistoryMessage, AiHistoryQuery } from './ai-history';

describe('ai-history', () => {
  it('types an AiHistoryQuery with the expected optional cursor fields', () => {
    const q: AiHistoryQuery = {
      protocol: 'meshtastic',
      surface: 'channel',
      sinceMs: 0,
      untilMs: 1000,
      limit: 50,
      beforeAt: 900,
      beforeId: 7,
    };
    expect(q.limit).toBe(50);
    expect(q.beforeAt).toBe(900);
    expect(q.beforeId).toBe(7);
  });

  it('accepts Reticulum room-surface queries', () => {
    const q: AiHistoryQuery = {
      protocol: 'reticulum',
      surface: 'rrc',
      sinceMs: 0,
      untilMs: 1000,
      hubHash: 'abcd',
      room: 'lobby',
    };
    expect(q.surface).toBe('rrc');
    expect(q.room).toBe('lobby');
  });

  it('extends AiSummaryMessage with optional id and senderId', () => {
    const m: AiHistoryMessage = {
      id: 3,
      senderId: 1,
      at: 0,
      sender: 'N0CALL',
      body: 'hello',
    };
    expect(m.id).toBe(3);
    expect(m.senderId).toBe(1);
    expect(m.body).toBe('hello');
  });
});
