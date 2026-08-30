import { describe, expect, it } from 'vitest';

import type { GameSession } from '@/shared/games-types';

import {
  applyOptimisticChessMove,
  applyOptimisticFourInARowMove,
  applyOptimisticTttMove,
  fourInARowDropRow,
  fourInARowWinCells,
  restoreOptimisticBackup,
  snapshotSessionForOptimistic,
} from './reticulumGamesOptimistic';

const EMPTY_FOUR = '_'.repeat(42);

function fourSession(board = EMPTY_FOUR, overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'four_in_a_row',
    app_version: 1,
    contact_hash: 'peer',
    initiator: 'me',
    status: 'active',
    metadata: {
      board,
      turn: 'me',
      first_turn: 'me',
      my_marker: 'A',
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

/** Place markers on a 42-cell row-major board (`row * 7 + column`). */
function fourBoard(placements: [number, number, string][]): string {
  const cells = EMPTY_FOUR.split('');
  for (const [row, column, marker] of placements) {
    cells[row * 7 + column] = marker;
  }
  return cells.join('');
}

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

  it('relocates the rook on kingside castling', () => {
    const session = baseSession({
      app_id: 'chess',
      metadata: {
        fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
        turn: 'me',
        move_count: 0,
        legal_moves: ['e1g1'],
        moves: [],
      },
    });
    const next = applyOptimisticChessMove(session, 'e1g1');
    const placement = String(next.metadata.fen).split(/\s+/)[0] ?? '';
    // King on g1, rook on f1 (rank 1: files a..h → R...KR.. from a1 empty of a-rook?).
    // Starting: R3K2R → after e1g1: R4RK1 (a1 rook stays, king g1, rook f1).
    expect(placement.endsWith('/R4RK1') || placement.includes('R4RK1')).toBe(true);
    expect(String(next.metadata.fen)).toContain(' b ');
  });

  it('clears the captured pawn on en passant', () => {
    // White pawn e5, black pawn d5, ep target d6 — e5d6 captures d5.
    const session = baseSession({
      app_id: 'chess',
      metadata: {
        fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
        turn: 'me',
        move_count: 0,
        legal_moves: ['e5d6'],
        moves: [],
      },
    });
    const next = applyOptimisticChessMove(session, 'e5d6');
    const placement = String(next.metadata.fen).split(/\s+/)[0] ?? '';
    // d5 must be empty; white pawn on d6.
    expect(placement).not.toMatch(/3pP3|3Pp3|3p1P|3P1p/);
    expect(placement).toContain('3P4');
    expect(String(next.metadata.fen).split(/\s+/)[3]).toBe('-');
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
  });

  describe('four in a row', () => {
    it('drops into the bottom row of an empty column', () => {
      const next = applyOptimisticFourInARowMove(fourSession(), 3);
      // Bottom row is row 5, so cell index 5 * 7 + 3 = 38.
      expect(String(next.metadata.board).charAt(38)).toBe('A');
      expect(next.metadata.last_row).toBe(5);
      expect(next.metadata.last_column).toBe(3);
      expect(next.metadata.last_cell).toBe(38);
      expect(next.metadata.move_count).toBe(1);
      expect(next.metadata.turn).toBe('peer');
      expect(next.delivery_state).toBe('pending');
    });

    it('stacks on top of an occupied cell rather than overwriting it', () => {
      const next = applyOptimisticFourInARowMove(fourSession(fourBoard([[5, 0, 'B']])), 0);
      expect(String(next.metadata.board).charAt(35)).toBe('B');
      expect(String(next.metadata.board).charAt(28)).toBe('A');
    });

    it('leaves the board untouched when the column is full', () => {
      const full = fourBoard(
        [0, 1, 2, 3, 4, 5].map((row) => [row, 2, 'A'] as [number, number, string]),
      );
      const next = applyOptimisticFourInARowMove(fourSession(full), 2);
      expect(next.metadata.board).toBe(full);
      expect(next.metadata.move_count).toBe(0);
      expect(next.delivery_state).toBe('pending');
    });

    it('ignores an out-of-range column', () => {
      expect(applyOptimisticFourInARowMove(fourSession(), 7).metadata.board).toBe(EMPTY_FOUR);
      expect(applyOptimisticFourInARowMove(fourSession(), -1).metadata.board).toBe(EMPTY_FOUR);
    });

    it('marks a horizontal win as terminal', () => {
      const board = fourBoard([
        [5, 0, 'A'],
        [5, 1, 'A'],
        [5, 2, 'A'],
      ]);
      const next = applyOptimisticFourInARowMove(fourSession(board), 3);
      expect(next.metadata.terminal).toBe('win');
      expect(next.metadata.winner).toBe('me');
      expect(next.status).toBe('completed');
      expect(next.metadata.turn).toBe('');
    });

    it('marks a diagonal win as terminal', () => {
      const board = fourBoard([
        [5, 0, 'A'],
        [4, 1, 'A'],
        [3, 2, 'A'],
        // Support so the drop in column 3 lands on row 2.
        [5, 1, 'B'],
        [5, 2, 'B'],
        [4, 2, 'B'],
        [5, 3, 'B'],
        [4, 3, 'B'],
        [3, 3, 'B'],
      ]);
      const next = applyOptimisticFourInARowMove(fourSession(board), 3);
      expect(next.metadata.last_row).toBe(2);
      expect(next.metadata.terminal).toBe('win');
    });

    it('derives the marker from first_turn when my_marker is absent', () => {
      const session = fourSession(EMPTY_FOUR, {
        identity_id: 'me',
        metadata: { board: EMPTY_FOUR, turn: 'me', first_turn: 'peer', move_count: 0 },
      });
      const next = applyOptimisticFourInARowMove(session, 0);
      expect(String(next.metadata.board).charAt(35)).toBe('B');
    });

    it('rolls back to the snapshot', () => {
      const session = fourSession();
      const backup = snapshotSessionForOptimistic(session);
      const next = applyOptimisticFourInARowMove(session, 0);
      expect(next.metadata.move_count).toBe(1);
      expect(restoreOptimisticBackup(backup).metadata.board).toBe(EMPTY_FOUR);
    });

    it('reports the drop row and win cells directly', () => {
      expect(fourInARowDropRow(EMPTY_FOUR.split(''), 0)).toBe(5);
      expect(fourInARowDropRow(EMPTY_FOUR.split(''), 9)).toBeNull();
      const winning = fourBoard([
        [5, 0, 'B'],
        [4, 0, 'B'],
        [3, 0, 'B'],
        [2, 0, 'B'],
      ]);
      expect(fourInARowWinCells(winning.split(''))).toEqual([14, 21, 28, 35]);
      expect(fourInARowWinCells(EMPTY_FOUR.split(''))).toBeNull();
    });
  });
});
