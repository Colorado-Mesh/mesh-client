import { useTranslation } from 'react-i18next';

import {
  gamesMetaBool,
  gamesMetaNum,
  gamesMetaStr,
} from '@/renderer/lib/reticulum/reticulumGamesMetadata';
import type { GameSession } from '@/shared/games-types';

export interface TicTacToeBoardProps {
  session: GameSession;
  onMove: (cellIndex: number) => void;
  disabled?: boolean;
}

const EMPTY_CELL = '_';

/** LRGP `ttt` app board — 9-char board string, moves sent as `{ i: cellIndex }`. */
export function TicTacToeBoard({ session, onMove, disabled = false }: TicTacToeBoardProps) {
  const { t } = useTranslation();
  const metadata = session.metadata;
  const board = gamesMetaStr(metadata, 'board', '_________');
  const myMarker = gamesMetaStr(metadata, 'my_marker');
  const turn = gamesMetaStr(metadata, 'turn');
  const terminal = gamesMetaStr(metadata, 'terminal');
  const winner = gamesMetaStr(metadata, 'winner');
  const drawOffered = gamesMetaBool(metadata, 'draw_offered');
  const moveCount = gamesMetaNum(metadata, 'move_count');

  const isActive = session.status === 'active';
  const isMyTurn = isActive && turn === session.identity_id;
  const cells = board.padEnd(9, EMPTY_CELL).slice(0, 9).split('');

  let statusText: string;
  if (terminal === 'win') {
    statusText =
      winner === session.identity_id ? t('gamesPanel.ttt.youWon') : t('gamesPanel.ttt.opponentWon');
  } else if (terminal === 'draw') {
    statusText = t('gamesPanel.ttt.draw');
  } else if (!isActive) {
    statusText = t(`gamesPanel.status.${session.status}`, {
      defaultValue: session.status,
    });
  } else if (isMyTurn) {
    statusText = t('gamesPanel.ttt.yourTurn');
  } else {
    statusText = t('gamesPanel.ttt.opponentTurn');
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-sm text-amber-100">{statusText}</div>
      {myMarker && (
        <div className="text-xs text-amber-200/60">
          {t('gamesPanel.ttt.yourMarker', { marker: myMarker })}
          {moveCount > 0 ? ` · ${t('gamesPanel.ttt.moveCount', { count: moveCount })}` : ''}
        </div>
      )}
      <div
        className="grid grid-cols-3 gap-1"
        role="group"
        aria-label={t('gamesPanel.ttt.boardAria')}
      >
        {cells.map((cell, index) => {
          const isEmpty = cell === EMPTY_CELL;
          const cellDisabled = disabled || !isMyTurn || !isEmpty;
          return (
            <button
              key={index}
              type="button"
              className="flex h-14 w-14 items-center justify-center rounded border border-amber-800/50 bg-amber-950/40 text-2xl font-bold text-amber-100 enabled:hover:bg-amber-900/60 disabled:cursor-default disabled:opacity-70"
              aria-label={
                isEmpty
                  ? t('gamesPanel.ttt.cellEmptyAria', { index: index + 1 })
                  : t('gamesPanel.ttt.cellOccupiedAria', { index: index + 1, marker: cell })
              }
              disabled={cellDisabled}
              onClick={() => {
                onMove(index);
              }}
            >
              {isEmpty ? '' : cell}
            </button>
          );
        })}
      </div>
      {drawOffered && isActive && (
        <div className="text-xs text-amber-300">{t('gamesPanel.drawOfferedBanner')}</div>
      )}
    </div>
  );
}
