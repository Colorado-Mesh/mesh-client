/** Client-side optimistic board patches for LRGP Games (Ratspeak-style). */

import {
  gamesMetaNum,
  gamesMetaStr,
  gamesMetaStrArray,
} from '@/renderer/lib/reticulum/reticulumGamesMetadata';
import type { GameSession } from '@/shared/games-types';

const EMPTY_CELL = '_';
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';

export function snapshotSessionForOptimistic(session: GameSession): GameSession {
  return {
    ...session,
    metadata: { ...session.metadata },
  };
}

export function restoreOptimisticBackup(backup: GameSession): GameSession {
  return {
    ...backup,
    metadata: { ...backup.metadata },
  };
}

function tttWinCells(board: string): number[] | null {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const line of lines) {
    const [a, b, c] = line;
    const ch = board[a];
    if (ch && ch !== EMPTY_CELL && ch === board[b] && ch === board[c]) {
      return line;
    }
  }
  return null;
}

/** Apply a TTT move locally before the sidecar confirms. */
export function applyOptimisticTttMove(session: GameSession, cellIndex: number): GameSession {
  const metadata = { ...session.metadata };
  const boardRaw = gamesMetaStr(metadata, 'board', '_________');
  const cells = boardRaw.padEnd(9, EMPTY_CELL).slice(0, 9).split('');
  if (cellIndex < 0 || cellIndex > 8 || cells[cellIndex] !== EMPTY_CELL) {
    return { ...session, delivery_state: 'pending', metadata };
  }
  let myMarker = gamesMetaStr(metadata, 'my_marker');
  if (!myMarker) {
    const first = gamesMetaStr(metadata, 'first_turn');
    myMarker = first === session.identity_id ? 'X' : 'O';
  }
  cells[cellIndex] = myMarker;
  const newBoard = cells.join('');
  const moveCount = gamesMetaNum(metadata, 'move_count') + 1;
  metadata.board = newBoard;
  metadata.move_count = moveCount;

  const win = tttWinCells(newBoard);
  const isDraw = !win && !newBoard.includes(EMPTY_CELL);
  if (win) {
    metadata.terminal = 'win';
    metadata.winner = session.identity_id;
    metadata.turn = '';
    return {
      ...session,
      status: 'completed',
      delivery_state: 'pending',
      metadata,
    };
  }
  if (isDraw) {
    metadata.terminal = 'draw';
    metadata.winner = '';
    metadata.turn = '';
    return {
      ...session,
      status: 'completed',
      delivery_state: 'pending',
      metadata,
    };
  }
  metadata.turn = session.contact_hash;
  return {
    ...session,
    delivery_state: 'pending',
    metadata,
  };
}

function parseFenPlacement(fen: string): string[][] {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  return placement.split('/').map((rankRow) => {
    const row: string[] = [];
    for (const ch of rankRow) {
      if (/[1-8]/.test(ch)) {
        row.push(...Array.from({ length: Number(ch) }, () => ''));
      } else {
        row.push(ch);
      }
    }
    while (row.length < 8) row.push('');
    return row.slice(0, 8);
  });
}

function encodeFenPlacement(board: string[][]): string {
  return board
    .map((row) => {
      let out = '';
      let empty = 0;
      for (const cell of row) {
        if (!cell) {
          empty += 1;
        } else {
          if (empty > 0) {
            out += String(empty);
            empty = 0;
          }
          out += cell;
        }
      }
      if (empty > 0) out += String(empty);
      return out;
    })
    .join('/');
}

function squareToIdx(square: string): { rank: number; file: number } | null {
  if (square.length < 2) return null;
  const file = FILES.indexOf(square.charAt(0));
  const rank = Number(square.charAt(1));
  if (file < 0 || rank < 1 || rank > 8) return null;
  return { rank: 8 - rank, file };
}

/**
 * Apply a UCI chess move onto FEN piece placement (optimistic; not a full rules engine).
 * Honors promotion suffix (`q`/`r`/`b`/`n`).
 */
export function applyOptimisticChessMove(session: GameSession, uci: string): GameSession {
  const metadata = { ...session.metadata };
  const fen = gamesMetaStr(metadata, 'fen', STARTING_FEN);
  const board = parseFenPlacement(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length >= 5 ? uci.charAt(4).toLowerCase() : '';
  const fromIdx = squareToIdx(from);
  const toIdx = squareToIdx(to);
  if (!fromIdx || !toIdx) {
    return { ...session, delivery_state: 'pending', metadata };
  }
  // parseFenPlacement always yields an 8×8 board for valid FEN placement.
  let piece = board[fromIdx.rank][fromIdx.file] ?? '';
  if (!piece) {
    return { ...session, delivery_state: 'pending', metadata };
  }
  if (promo && 'qrbn'.includes(promo)) {
    const isWhite = piece === piece.toUpperCase();
    piece = isWhite ? promo.toUpperCase() : promo;
  }
  const next = board.map((row) => [...row]);
  next[fromIdx.rank][fromIdx.file] = '';
  next[toIdx.rank][toIdx.file] = piece;

  const parts = fen.trim().split(/\s+/);
  const rest = parts.slice(1);
  // Flip side-to-move in FEN if present.
  if (rest.length > 0) {
    rest[0] = rest[0] === 'w' ? 'b' : 'w';
  }
  metadata.fen = [encodeFenPlacement(next), ...rest].join(' ');
  metadata.move_count = gamesMetaNum(metadata, 'move_count') + 1;
  metadata.turn = session.contact_hash;
  metadata.legal_moves = [];
  const prevMoves = gamesMetaStrArray(metadata, 'moves');
  metadata.moves = [...prevMoves, uci];
  metadata.last_move = uci;

  return {
    ...session,
    delivery_state: 'pending',
    metadata,
  };
}
