import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  gamesMetaBool,
  gamesMetaStr,
  gamesMetaStrArray,
} from '@/renderer/lib/reticulum/reticulumGamesMetadata';
import type { GameSession } from '@/shared/games-types';

export interface ChessBoardProps {
  session: GameSession;
  /** UCI move string, e.g. `e2e4` or `e7e8q`. */
  onMove: (uci: string) => void;
  disabled?: boolean;
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const PIECE_GLYPHS: Record<string, string> = {
  K: '♔',
  Q: '♕',
  R: '♖',
  B: '♗',
  N: '♘',
  P: '♙',
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};

/** Parses FEN piece placement into board[rank8..rank1][a..h], '' for empty squares. */
function parseFenBoard(fen: string): string[][] {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  return placement.split('/').map((rankRow) => {
    const row: string[] = [];
    for (const ch of rankRow) {
      if (/[1-8]/.test(ch)) {
        row.push(...Array.from<string>({ length: Number(ch) }).fill(''));
      } else {
        row.push(ch);
      }
    }
    while (row.length < 8) row.push('');
    return row.slice(0, 8);
  });
}

function squareName(rankIdx: number, fileIdx: number): string {
  const file = FILES[fileIdx] ?? 'a';
  const rank = 8 - rankIdx;
  return `${file}${rank}`;
}

function isWhitePiece(piece: string): boolean {
  return piece.length > 0 && piece === piece.toUpperCase();
}

/** LRGP `chess` app board — FEN state, moves sent as `{ m: uciMove }`. */
export function ChessBoard({ session, onMove, disabled = false }: ChessBoardProps) {
  const { t } = useTranslation();
  const metadata = session.metadata;
  const fen = gamesMetaStr(metadata, 'fen', STARTING_FEN);
  const myColor = gamesMetaStr(metadata, 'my_color');
  const turn = gamesMetaStr(metadata, 'turn');
  const terminal = gamesMetaStr(metadata, 'terminal');
  const winner = gamesMetaStr(metadata, 'winner');
  const inCheck = gamesMetaBool(metadata, 'in_check');
  const drawOffered = gamesMetaBool(metadata, 'draw_offered');
  const legalMoves = gamesMetaStrArray(metadata, 'legal_moves');

  const [selected, setSelected] = useState<string | null>(null);

  const board = useMemo(() => parseFenBoard(fen), [fen]);
  const isActive = session.status === 'active';
  const isMyTurn = isActive && turn === session.identity_id;
  const flipped = myColor === 'b';

  let statusText: string;
  if (terminal === 'win') {
    statusText =
      winner === session.identity_id
        ? t('gamesPanel.chess.youWon')
        : t('gamesPanel.chess.opponentWon');
  } else if (terminal === 'draw') {
    statusText = t('gamesPanel.chess.draw');
  } else if (!isActive) {
    statusText = t(`gamesPanel.status.${session.status}`, {
      defaultValue: session.status,
    });
  } else if (isMyTurn) {
    statusText = inCheck ? t('gamesPanel.chess.yourTurnInCheck') : t('gamesPanel.chess.yourTurn');
  } else {
    statusText = t('gamesPanel.chess.opponentTurn');
  }

  const displayRows = flipped ? [...board].reverse() : board;

  function handleSquareClick(rankIdx: number, fileIdx: number) {
    if (disabled || !isMyTurn) return;
    const actualRankIdx = flipped ? 7 - rankIdx : rankIdx;
    const actualFileIdx = flipped ? 7 - fileIdx : fileIdx;
    const square = squareName(actualRankIdx, actualFileIdx);
    const piece = board[actualRankIdx]?.[actualFileIdx] ?? '';

    if (!selected) {
      const isOwn = myColor === 'w' ? isWhitePiece(piece) : piece !== '' && !isWhitePiece(piece);
      if (piece && isOwn) setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    const movingPiece = pieceAt(board, selected);
    const isPromotion =
      movingPiece.toLowerCase() === 'p' && (square.endsWith('8') || square.endsWith('1'));
    const uci = `${selected}${square}${isPromotion ? 'q' : ''}`;
    setSelected(null);
    onMove(uci);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-sm text-amber-100">{statusText}</div>
      <div
        className="grid grid-cols-8 border border-amber-800/60"
        role="group"
        aria-label={t('gamesPanel.chess.boardAria')}
      >
        {displayRows.map((row, rowIdx) =>
          (flipped ? [...row].reverse() : row).map((piece, colIdx) => {
            const actualRankIdx = flipped ? 7 - rowIdx : rowIdx;
            const actualFileIdx = flipped ? 7 - colIdx : colIdx;
            const square = squareName(actualRankIdx, actualFileIdx);
            const dark = (actualRankIdx + actualFileIdx) % 2 === 1;
            const isSelected = selected === square;
            return (
              <button
                key={square}
                type="button"
                className={`flex h-10 w-10 items-center justify-center text-xl ${
                  dark ? 'bg-amber-900/70' : 'bg-amber-100/10'
                } ${isSelected ? 'ring-2 ring-cyan-400' : ''} enabled:hover:brightness-125 disabled:cursor-default`}
                aria-label={t('gamesPanel.chess.squareAria', {
                  square,
                  piece: piece
                    ? t(`gamesPanel.chess.pieceNames.${piece}`, { defaultValue: piece })
                    : t('gamesPanel.chess.emptySquare'),
                })}
                disabled={disabled || !isMyTurn}
                onClick={() => {
                  handleSquareClick(rowIdx, colIdx);
                }}
              >
                {piece ? (PIECE_GLYPHS[piece] ?? piece) : ''}
              </button>
            );
          }),
        )}
      </div>
      {isActive && legalMoves.length > 0 && (
        <div className="flex max-w-sm flex-wrap justify-center gap-1">
          {legalMoves.map((move) => (
            <button
              key={move}
              type="button"
              className="rounded border border-amber-800/50 bg-amber-950/40 px-1.5 py-0.5 text-xs text-amber-200 enabled:hover:bg-amber-900/60"
              aria-label={t('gamesPanel.chess.legalMoveAria', { move })}
              disabled={disabled || !isMyTurn}
              onClick={() => {
                onMove(move);
              }}
            >
              {move}
            </button>
          ))}
        </div>
      )}
      {drawOffered && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferedBanner')}</div>
      )}
    </div>
  );
}

function pieceAt(board: string[][], square: string): string {
  const file = FILES.indexOf(square.charAt(0));
  const rank = Number(square.charAt(1));
  if (file < 0 || !Number.isFinite(rank)) return '';
  const rankIdx = 8 - rank;
  return board[rankIdx]?.[file] ?? '';
}
