import { useTranslation } from 'react-i18next';

import {
  gamesMetaNum,
  gamesMetaStr,
  isGamesDrawOfferFromOpponent,
  isGamesDrawOfferFromSelf,
} from '@/renderer/lib/reticulum/reticulumGamesMetadata';
import {
  FOUR_IN_A_ROW_COLUMNS,
  FOUR_IN_A_ROW_EMPTY_BOARD,
  FOUR_IN_A_ROW_ROWS,
  fourInARowCells,
  fourInARowDropRow,
  fourInARowWinCells,
} from '@/renderer/lib/reticulum/reticulumGamesOptimistic';
import type { GameSession } from '@/shared/games-types';

export interface FourInARowBoardProps {
  session: GameSession;
  onMove: (column: number) => void;
  disabled?: boolean;
}

const EMPTY_CELL = '_';

/** Theme-neutral LRGP markers: `A` is the challenger, `B` the responder. */
const MARKER_CLASS: Record<string, string> = {
  A: 'bg-red-600 text-white',
  B: 'bg-cyan-600 text-white',
};

/**
 * LRGP `four_in_a_row.1` board — 42-cell row-major gravity board (`row * 7 + column`),
 * moves sent as `{ c: column }`. Clicking a column drops into its lowest empty row.
 */
export function FourInARowBoard({ session, onMove, disabled = false }: FourInARowBoardProps) {
  const { t } = useTranslation();
  const metadata = session.metadata;
  const cells = fourInARowCells(gamesMetaStr(metadata, 'board', FOUR_IN_A_ROW_EMPTY_BOARD));
  const myMarker = gamesMetaStr(metadata, 'my_marker');
  const turn = gamesMetaStr(metadata, 'turn');
  const terminal = gamesMetaStr(metadata, 'terminal');
  const winner = gamesMetaStr(metadata, 'winner');
  const drawOfferedByOpponent = isGamesDrawOfferFromOpponent(session);
  const drawOfferedBySelf = isGamesDrawOfferFromSelf(session);
  const moveCount = gamesMetaNum(metadata, 'move_count');

  const isActive = session.status === 'active';
  const isMyTurn = isActive && turn === session.identity_id;
  const winCells = terminal === 'win' ? fourInARowWinCells(cells) : null;
  const winSet = new Set(winCells ?? []);

  let statusText: string;
  if (terminal === 'win') {
    statusText =
      winner === session.identity_id
        ? t('gamesPanel.fourInARow.youWon')
        : t('gamesPanel.fourInARow.opponentWon');
  } else if (terminal === 'draw') {
    statusText = t('gamesPanel.fourInARow.draw');
  } else if (!isActive) {
    statusText = t(`gamesPanel.status.${session.status}`, { defaultValue: session.status });
  } else if (isMyTurn) {
    statusText = t('gamesPanel.fourInARow.yourTurn');
  } else {
    statusText = t('gamesPanel.fourInARow.opponentTurn');
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-sm text-gray-100">{statusText}</div>
      {myMarker && (
        <div className="text-xs text-gray-400">
          {t('gamesPanel.fourInARow.yourMarker', { marker: myMarker })}
          {moveCount > 0 ? ` · ${t('gamesPanel.fourInARow.moveCount', { count: moveCount })}` : ''}
        </div>
      )}
      <div
        className="flex gap-1 rounded bg-slate-900/60 p-1"
        role="group"
        aria-label={t('gamesPanel.fourInARow.boardAria')}
      >
        {Array.from({ length: FOUR_IN_A_ROW_COLUMNS }, (_, column) => {
          const dropRow = fourInARowDropRow(cells, column);
          const columnFull = dropRow === null;
          const columnDisabled = disabled || !isMyTurn || columnFull;
          // Discs are decorative; the column button carries the readable state.
          const stacked: string[] = [];
          for (let row = FOUR_IN_A_ROW_ROWS - 1; row >= 0; row -= 1) {
            const marker = cells[row * FOUR_IN_A_ROW_COLUMNS + column] ?? EMPTY_CELL;
            if (marker !== EMPTY_CELL) stacked.push(marker);
          }
          const contents =
            stacked.length > 0
              ? stacked.join(', ')
              : t('gamesPanel.fourInARow.columnEmptyContents');
          return (
            <button
              key={column}
              type="button"
              className="flex flex-col gap-1 rounded p-1 enabled:hover:bg-slate-700/70 disabled:cursor-default"
              aria-label={
                columnFull
                  ? t('gamesPanel.fourInARow.columnFullAria', { column: column + 1, contents })
                  : t('gamesPanel.fourInARow.columnAria', { column: column + 1, contents })
              }
              disabled={columnDisabled}
              onClick={() => {
                onMove(column);
              }}
            >
              {Array.from({ length: FOUR_IN_A_ROW_ROWS }, (_, row) => {
                const index = row * FOUR_IN_A_ROW_COLUMNS + column;
                const marker = cells[index] ?? EMPTY_CELL;
                const isEmpty = marker === EMPTY_CELL;
                const fill = isEmpty
                  ? 'bg-slate-800 text-transparent'
                  : (MARKER_CLASS[marker] ?? 'bg-gray-500 text-white');
                return (
                  <span
                    key={row}
                    aria-hidden="true"
                    className={`flex h-9 w-9 items-center justify-center rounded-full border border-slate-600 text-sm font-bold ${fill} ${
                      winSet.has(index) ? 'ring-2 ring-yellow-300' : ''
                    }`}
                  >
                    {isEmpty ? '' : marker}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
      {drawOfferedByOpponent && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferedBanner')}</div>
      )}
      {drawOfferedBySelf && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferWaitingBanner')}</div>
      )}
    </div>
  );
}
