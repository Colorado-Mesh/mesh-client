import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  chessCapturedFromFen,
  type ChessCapturedTray,
} from '@/renderer/lib/reticulum/chessCaptured';
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
  const material = useMemo(() => chessCapturedFromFen(fen), [fen]);
  const isActive = session.status === 'active';
  const isMyTurn = isActive && turn === session.identity_id;
  const flipped = myColor === 'b';
  // Opponent tray above the board; own tray below (Ratspeak layout).
  const opponentTray = flipped ? material.whiteCaptured : material.blackCaptured;
  const myTray = flipped ? material.blackCaptured : material.whiteCaptured;
  const myAdvantage = flipped ? -material.advantage : material.advantage;

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
    <div className="relative flex w-full max-w-[min(100%,28rem)] flex-col items-center gap-3">
      <div className="text-ink-100 text-sm">{statusText}</div>
      <CapturedTrayRow
        tray={opponentTray}
        showAdvantage={myAdvantage < 0}
        advantageAbs={Math.abs(myAdvantage)}
        whitePieces={!flipped}
        label={t('gamesPanel.chess.opponentCaptured')}
      />
      <div
        className="border-ink-600 relative aspect-square w-full max-w-[min(100%,24rem)] border"
        role="group"
        aria-label={t('gamesPanel.chess.boardAria')}
      >
        <div className="grid h-full w-full grid-cols-8">
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
                  className={`flex aspect-square items-center justify-center text-[clamp(0.875rem,4vw,1.25rem)] ${
                    dark ? 'bg-ink-700' : 'bg-ink-600'
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
        </div>
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
              className="bg-deep-black border-ink-600 relative z-20 flex flex-col gap-1 rounded border p-2"
            >
              {promoOptions.map((p) => {
                const glyphKey = myColor === 'b' ? p : p.toUpperCase();
                return (
                  <button
                    key={p}
                    type="button"
                    className="text-ink-100 hover:bg-ink-800 flex h-10 w-10 items-center justify-center rounded text-2xl disabled:cursor-default disabled:opacity-40"
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
      <CapturedTrayRow
        tray={myTray}
        showAdvantage={myAdvantage > 0}
        advantageAbs={Math.abs(myAdvantage)}
        whitePieces={flipped}
        label={t('gamesPanel.chess.youCaptured')}
      />
      {isActive && legalMoves.length > 0 && !promoBase && (
        <div className="flex max-w-sm flex-wrap justify-center gap-1">
          {legalMoves.map((move) => (
            <button
              key={move}
              type="button"
              className="border-ink-600 bg-ink-800/80 text-ink-300 enabled:hover:bg-ink-700 rounded border px-1.5 py-0.5 text-xs"
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
        <div className="text-xs text-orange-300">{t('gamesPanel.drawOfferedBanner')}</div>
      )}
      {drawOfferedBySelf && isActive && (
        <div className="text-xs text-orange-300">{t('gamesPanel.drawOfferWaitingBanner')}</div>
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

function CapturedTrayRow({
  tray,
  showAdvantage,
  advantageAbs,
  whitePieces,
  label,
}: Readonly<{
  tray: ChessCapturedTray;
  showAdvantage: boolean;
  advantageAbs: number;
  whitePieces: boolean;
  label: string;
}>) {
  const { t } = useTranslation();
  return (
    <div
      className="border-ink-700/60 bg-ink-900/40 flex min-h-8 w-full flex-wrap items-center gap-2 rounded border px-2 py-1"
      aria-label={label}
    >
      <span className="text-muted text-2xs shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {tray.pieces.length === 0 ? (
          <span className="text-muted text-2xs">—</span>
        ) : (
          tray.pieces.map(({ kind, count }) => {
            const glyphKey = whitePieces ? kind.toUpperCase() : kind;
            return (
              <span key={kind} className="text-ink-200 text-sm tabular-nums">
                {PIECE_GLYPHS[glyphKey] ?? kind}
                {count > 1 ? <span className="text-muted text-2xs">×{count}</span> : null}
              </span>
            );
          })
        )}
      </div>
      {showAdvantage && advantageAbs > 0 ? (
        <span className="bg-ink-800 text-bright-green text-2xs ml-auto rounded px-1.5 py-0.5 font-medium">
          {t('gamesPanel.chess.materialAdvantage', { value: advantageAbs })}
        </span>
      ) : null}
    </div>
  );
}
