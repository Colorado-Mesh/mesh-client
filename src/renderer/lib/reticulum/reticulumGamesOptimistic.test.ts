// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { GameSession } from '@/shared/games-types';

import {
  applyOptimisticChessMove,
  applyOptimisticTttMove,
  restoreOptimisticBackup,
  snapshotSessionForOptimistic,
} from './reticulumGamesOptimistic';

function baseSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: 'peer',
    initiator: 'me',
    status: 'active',
    metadata: {
      board: '_________',
      turn: 'me',
      my_marker: 'X',
      move_count: 0,
      winner: '',
      terminal: '',
    },
    unread: 0,
    created_at: 1,
    updated_at: 1,
    last_action_at: 1,
    ...overrides,
  };
}

describe('reticulumGamesOptimistic', () => {
  it('applies and rolls back a TTT move', () => {
    const session = baseSession();
    const backup = snapshotSessionForOptimistic(session);
    const next = applyOptimisticTttMove(session, 0);
    expect(next.metadata.board).toBe('X________');
    expect(next.metadata.turn).toBe('peer');
    expect(next.delivery_state).toBe('pending');
    const restored = restoreOptimisticBackup(backup);
    expect(restored.metadata.board).toBe('_________');
  });

  it('marks TTT win terminal on optimistic apply', () => {
    const session = baseSession({
      metadata: {
        board: 'XX_______',
        turn: 'me',
        my_marker: 'X',
        move_count: 2,
        winner: '',
        terminal: '',
      },
    });
    const next = applyOptimisticTttMove(session, 2);
    expect(next.status).toBe('completed');
    expect(next.metadata.terminal).toBe('win');
    expect(next.metadata.winner).toBe('me');
  });

  it('applies chess UCI and honors promotion piece', () => {
    const session = baseSession({
      app_id: 'chess',
      metadata: {
        fen: '8/P7/8/8/8/8/8/4K2k w - - 0 1',
        turn: 'me',
        move_count: 0,
        legal_moves: ['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n'],
        moves: [],
      },
    });
    const next = applyOptimisticChessMove(session, 'a7a8r');
    const placement = String(next.metadata.fen).split(/\s+/)[0] ?? '';
    expect(placement.startsWith('R7')).toBe(true);
    expect(next.metadata.turn).toBe('peer');
    expect(next.metadata.move_count).toBe(1);
    expect(next.delivery_state).toBe('pending');
  });

  it('restores chess backup metadata', () => {
    const session = baseSession({
      app_id: 'chess',
      metadata: {
        fen: '4k3/4P3/8/8/8/8/8/4K3 w - - 0 1',
        turn: 'me',
        move_count: 0,
        legal_moves: ['e7e8q'],
      },
    });
    const backup = snapshotSessionForOptimistic(session);
    const next = applyOptimisticChessMove(session, 'e7e8q');
    expect(next.metadata.move_count).toBe(1);
    const restored = restoreOptimisticBackup(backup);
    expect(restored.metadata.move_count).toBe(0);
    expect(restored.metadata.fen).toBe(session.metadata.fen);
  });
});
