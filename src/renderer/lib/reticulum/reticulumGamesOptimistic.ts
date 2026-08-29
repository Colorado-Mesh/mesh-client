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

/** LRGP `four_in_a_row.1`: 7×6 gravity board, 42 cells row-major (`row * 7 + column`). */
export const FOUR_IN_A_ROW_COLUMNS = 7;
export const FOUR_IN_A_ROW_ROWS = 6;
export const FOUR_IN_A_ROW_CELL_COUNT = FOUR_IN_A_ROW_COLUMNS * FOUR_IN_A_ROW_ROWS;
export const FOUR_IN_A_ROW_EMPTY_BOARD = EMPTY_CELL.repeat(FOUR_IN_A_ROW_CELL_COUNT);

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

/** Normalize a stored board to exactly 42 cells. */
export function fourInARowCells(board: string): string[] {
  return board
    .padEnd(FOUR_IN_A_ROW_CELL_COUNT, EMPTY_CELL)
    .slice(0, FOUR_IN_A_ROW_CELL_COUNT)
    .split('');
}

/** Lowest empty row in `column`, or null when the column is full or out of range. */
export function fourInARowDropRow(cells: string[], column: number): number | null {
  if (!Number.isInteger(column) || column < 0 || column >= FOUR_IN_A_ROW_COLUMNS) return null;
  for (let row = FOUR_IN_A_ROW_ROWS - 1; row >= 0; row -= 1) {
    if (cells[row * FOUR_IN_A_ROW_COLUMNS + column] === EMPTY_CELL) return row;
  }
  return null;
}

const FOUR_IN_A_ROW_DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Cell indices of the first four-in-a-line, or null when there is no winner. */
export function fourInARowWinCells(cells: string[]): number[] | null {
  for (let row = 0; row < FOUR_IN_A_ROW_ROWS; row += 1) {
    for (let column = 0; column < FOUR_IN_A_ROW_COLUMNS; column += 1) {
      const marker = cells[row * FOUR_IN_A_ROW_COLUMNS + column];
      if (!marker || marker === EMPTY_CELL) continue;
      for (const [dRow, dColumn] of FOUR_IN_A_ROW_DIRECTIONS) {
        const line: number[] = [];
        for (let step = 0; step < 4; step += 1) {
          const r = row + dRow * step;
          const c = column + dColumn * step;
          if (r < 0 || r >= FOUR_IN_A_ROW_ROWS || c < 0 || c >= FOUR_IN_A_ROW_COLUMNS) break;
          if (cells[r * FOUR_IN_A_ROW_COLUMNS + c] !== marker) break;
          line.push(r * FOUR_IN_A_ROW_COLUMNS + c);
        }
        if (line.length === 4) return line;
      }
    }
  }
  return null;
}

/**
 * Apply a Four in a Row column drop locally before the sidecar confirms.
 * Mirrors `applyOptimisticTttMove`; the wire payload is `{ c }`.
 */
export function applyOptimisticFourInARowMove(session: GameSession, column: number): GameSession {
  const metadata = { ...session.metadata };
  const cells = fourInARowCells(gamesMetaStr(metadata, 'board', FOUR_IN_A_ROW_EMPTY_BOARD));
  const row = fourInARowDropRow(cells, column);
  if (row === null) {
    return { ...session, delivery_state: 'pending', metadata };
  }
  let myMarker = gamesMetaStr(metadata, 'my_marker');
  if (!myMarker) {
    myMarker = gamesMetaStr(metadata, 'first_turn') === session.identity_id ? 'A' : 'B';
  }
  const cell = row * FOUR_IN_A_ROW_COLUMNS + column;
  cells[cell] = myMarker;
  metadata.board = cells.join('');
  metadata.move_count = gamesMetaNum(metadata, 'move_count') + 1;
  metadata.last_column = column;
  metadata.last_row = row;
  metadata.last_cell = cell;

  const win = fourInARowWinCells(cells);
  if (win) {
    metadata.terminal = 'win';
    metadata.winner = session.identity_id;
    metadata.turn = '';
    return { ...session, status: 'completed', delivery_state: 'pending', metadata };
  }
  if (!cells.includes(EMPTY_CELL)) {
    metadata.terminal = 'draw';
    metadata.winner = '';
    metadata.turn = '';
    return { ...session, status: 'completed', delivery_state: 'pending', metadata };
  }
  metadata.turn = session.contact_hash;
  return { ...session, delivery_state: 'pending', metadata };
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
  // En passant: diagonal pawn move onto an empty square clears the captured pawn.
  const isPawn = piece.toLowerCase() === 'p';
  const fileDelta = toIdx.file - fromIdx.file;
  const destEmpty = !(next[toIdx.rank][toIdx.file] ?? '');
  if (isPawn && Math.abs(fileDelta) === 1 && destEmpty) {
    next[fromIdx.rank][toIdx.file] = '';
  }
  next[fromIdx.rank][fromIdx.file] = '';
  next[toIdx.rank][toIdx.file] = piece;
  // Castling: king moves two files; relocate the rook.
  if (piece.toLowerCase() === 'k' && Math.abs(fileDelta) === 2) {
    const kingside = fileDelta > 0;
    const rookFromFile = kingside ? 7 : 0;
    const rookToFile = kingside ? 5 : 3;
    const rook = next[fromIdx.rank][rookFromFile] ?? '';
    if (rook.toLowerCase() === 'r') {
      next[fromIdx.rank][rookFromFile] = '';
      next[fromIdx.rank][rookToFile] = rook;
    }
  }

  const parts = fen.trim().split(/\s+/);
  const rest = parts.slice(1);
  // Flip side-to-move in FEN if present.
  if (rest.length > 0) {
    rest[0] = rest[0] === 'w' ? 'b' : 'w';
  }
  // Clear en-passant target after any move (optimistic; full EP rights come from server).
  if (rest.length > 2) {
    rest[2] = '-';
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
