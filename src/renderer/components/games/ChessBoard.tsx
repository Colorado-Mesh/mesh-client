import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  gamesMetaBool,
  gamesMetaStr,
  gamesMetaStrArray,
  isGamesDrawOfferFromOpponent,
  isGamesDrawOfferFromSelf,
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
const PROMO_ORDER = ['q', 'r', 'b', 'n'] as const;

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

function promotionOptionsFor(baseUci: string, legalMoves: string[]): string[] {
  const found = PROMO_ORDER.filter((p) => legalMoves.includes(`${baseUci}${p}`));
  if (found.length > 0) return [...found];
  // Legal list may omit suffixes; still offer standard set when promoting.
  return [...PROMO_ORDER];
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
  const drawOfferedByOpponent = isGamesDrawOfferFromOpponent(session);
  const drawOfferedBySelf = isGamesDrawOfferFromSelf(session);
  const legalMoves = gamesMetaStrArray(metadata, 'legal_moves');

  const [selected, setSelected] = useState<string | null>(null);
  const [promoBase, setPromoBase] = useState<string | null>(null);

  const board = useMemo(() => parseFenBoard(fen), [fen]);
  const isActive = session.status === 'active';
  const isMyTurn = isActive && turn === session.identity_id;
  const flipped = myColor === 'b';

  useEffect(() => {
    if (!promoBase) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPromoBase(null);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [promoBase]);

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
  const promoOptions = promoBase ? promotionOptionsFor(promoBase, legalMoves) : [];

  function commitMove(uci: string) {
    if (disabled || !isMyTurn) return;
    setSelected(null);
    setPromoBase(null);
    onMove(uci);
  }

  function handleSquareClick(rankIdx: number, fileIdx: number) {
    if (disabled || !isMyTurn || promoBase) return;
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
    const base = `${selected}${square}`;
    if (isPromotion) {
      const options = promotionOptionsFor(base, legalMoves);
      if (options.length === 1) {
        commitMove(`${base}${options[0]}`);
        return;
      }
      setSelected(null);
      setPromoBase(base);
      return;
    }
    commitMove(base);
  }

  return (
    <div className="relative flex flex-col items-center gap-3">
      <div className="text-sm text-gray-100">{statusText}</div>
      <div
        className="relative grid grid-cols-8 border border-gray-600"
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
                  dark ? 'bg-slate-700' : 'bg-slate-600'
                } ${isSelected ? 'ring-2 ring-cyan-400' : ''} enabled:hover:brightness-125 disabled:cursor-default`}
                aria-label={t('gamesPanel.chess.squareAria', {
                  square,
                  piece: piece
                    ? t(`gamesPanel.chess.pieceNames.${piece}`, { defaultValue: piece })
                    : t('gamesPanel.chess.emptySquare'),
                })}
                disabled={disabled || !isMyTurn || !!promoBase}
                onClick={() => {
                  handleSquareClick(rowIdx, colIdx);
                }}
              >
                {piece ? (PIECE_GLYPHS[piece] ?? piece) : ''}
              </button>
            );
          }),
        )}
        {promoBase && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center"
            role="dialog"
            aria-label={t('gamesPanel.chess.promotionChooserAria')}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              aria-label={t('common.close')}
              onClick={() => {
                setPromoBase(null);
              }}
            />
            <div
              role="group"
              className="bg-deep-black relative z-20 flex flex-col gap-1 rounded border border-gray-600 p-2"
            >
              {promoOptions.map((p) => {
                const glyphKey = myColor === 'b' ? p : p.toUpperCase();
                return (
                  <button
                    key={p}
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded text-2xl text-gray-100 hover:bg-gray-800 disabled:cursor-default disabled:opacity-40"
                    aria-label={t(`gamesPanel.chess.promoteTo.${p}`)}
                    disabled={disabled || !isMyTurn}
                    onClick={() => {
                      commitMove(`${promoBase}${p}`);
                    }}
                  >
                    {PIECE_GLYPHS[glyphKey] ?? p}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {isActive && legalMoves.length > 0 && !promoBase && (
        <div className="flex max-w-sm flex-wrap justify-center gap-1">
          {legalMoves.map((move) => (
            <button
              key={move}
              type="button"
              className="rounded border border-gray-600 bg-slate-800/80 px-1.5 py-0.5 text-xs text-gray-300 enabled:hover:bg-gray-700"
              aria-label={t('gamesPanel.chess.legalMoveAria', { move })}
              disabled={disabled || !isMyTurn}
              onClick={() => {
                commitMove(move);
              }}
            >
              {move}
            </button>
          ))}
        </div>
      )}
      {drawOfferedByOpponent && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferedBanner')}</div>
      )}
      {drawOfferedBySelf && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferWaitingBanner')}</div>
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
