import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { DeliveryStatusBadgeFrame } from '@/renderer/components/DeliveryStatusBadgeFrame';
import { ChessBoard } from '@/renderer/components/games/ChessBoard';
import { TicTacToeBoard } from '@/renderer/components/games/TicTacToeBoard';
import {
  burstConfetti,
  type ConfettiBurstOptions,
  shouldSkipConfetti,
} from '@/renderer/lib/confettiBurst';
import {
  gamesMetaStr,
  isGamesDrawOfferFromOpponent,
  isGamesDrawOfferFromSelf,
  isGamesSessionInitiator,
  isGamesWinForSelf,
} from '@/renderer/lib/reticulum/reticulumGamesMetadata';
import {
  deleteGamesSession,
  markGamesSessionRead,
  refreshGamesApps,
  refreshGamesSessions,
  refreshGamesStatus,
  resendGamesAction,
  sendGamesAction,
  sendGamesChallenge,
} from '@/renderer/lib/reticulum/reticulumGamesSession';
import { resolveReticulumRemoteHashLabel } from '@/renderer/lib/reticulumVoiceRemoteLabel';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import {
  GAMES_CMD,
  GAMES_DRAW_CLAIM,
  type GamesAppId,
  type GameSession,
  isGamesDeliveryInFlight,
} from '@/shared/games-types';

export interface GamesPanelProps {
  isActive: boolean;
}

type GamesFilter = 'all' | 'active' | 'pending' | 'completed';

const GAMES_FILTERS: GamesFilter[] = ['all', 'active', 'pending', 'completed'];
const COMPLETED_STATUSES = new Set(['completed', 'expired', 'declined']);
const CHALLENGE_APPS: GamesAppId[] = ['ttt', 'chess'];
/** Delay before retrying a win celebration that was skipped because a burst was already animating. */
export const CELEBRATION_RETRY_MS = 400;

function matchesFilter(session: GameSession, filter: GamesFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return session.status === 'active';
  if (filter === 'pending') return session.status === 'pending';
  return COMPLETED_STATUSES.has(session.status);
}

function sessionPeerLabel(session: GameSession): string {
  const hash = session.contact_hash?.trim();
  if (!hash) return session.session_id.slice(0, 8);
  return resolveReticulumRemoteHashLabel(hash);
}

/** Confetti origin/palette for a win, centered on the board element when measurable. */
function winCelebrationOptions(
  session: GameSession,
  boardEl: HTMLElement | null,
): ConfettiBurstOptions {
  const opts: ConfettiBurstOptions =
    session.app_id === 'chess'
      ? {
          count: 72,
          duration: 1900,
          colors: ['#d4bc9e', '#9b8365', '#d4a72c', '#86efac', '#0e9aa7'],
        }
      : { count: 48, duration: 1600 };
  const rect = boardEl?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    opts.x = rect.left + rect.width / 2;
    opts.y = rect.top + rect.height / 2.4;
  }
  return opts;
}

export default function GamesPanel({ isActive }: GamesPanelProps) {
  const { t } = useTranslation();
  const sessions = useReticulumGamesStore((s) => s.sessions);
  const selectedSessionId = useReticulumGamesStore((s) => s.selectedSessionId);
  const actionBusy = useReticulumGamesStore((s) => s.actionBusy);
  const lastActionResult = useReticulumGamesStore((s) => s.lastActionResult);
  const selectSession = useReticulumGamesStore((s) => s.selectSession);
  // Re-resolve opponent labels when peer/contact names arrive or change.
  useReticulumPeerStore((s) => s.peersRevision);

  const [filter, setFilter] = useState<GamesFilter>('all');
  const [challengeHash, setChallengeHash] = useState('');
  const [challengeApp, setChallengeApp] = useState<GamesAppId>('ttt');
  const [confirmResign, setConfirmResign] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const celebratedWinsRef = useRef<Set<string>>(new Set());
  const celebrationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped to re-run the celebration effect after an in-flight burst finishes (retry a win that
  // was selected while confetti for an earlier win was still animating).
  const [celebrationRetryTick, setCelebrationRetryTick] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    void refreshGamesStatus();
    void refreshGamesApps();
    void refreshGamesSessions();
  }, [isActive]);

  const selectedSession = useMemo(
    () => sessions.find((row) => row.session_id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    if (isActive && selectedSession && selectedSession.unread > 0) {
      void markGamesSessionRead(selectedSession.session_id);
    }
  }, [isActive, selectedSession]);

  // One-shot confetti when the viewed session is a completed local win. Deduped per session_id so
  // re-renders / re-selection do not re-fire. A win is only recorded as celebrated once a burst
  // actually starts (or is intentionally skipped under reduced motion); if a burst is already
  // animating (single-flight), the win is retried after that burst finishes so a second win
  // selected mid-celebration is not silently dropped.
  useEffect(() => {
    if (!isActive || !selectedSession) return;
    if (!isGamesWinForSelf(selectedSession)) return;
    const sessionId = selectedSession.session_id;
    if (celebratedWinsRef.current.has(sessionId)) return;

    // Reduced motion: the burst is intentionally suppressed, so mark celebrated (don't retry).
    if (shouldSkipConfetti()) {
      celebratedWinsRef.current.add(sessionId);
      return;
    }

    const started = burstConfetti(winCelebrationOptions(selectedSession, boardWrapRef.current));
    if (started) {
      celebratedWinsRef.current.add(sessionId);
      return;
    }

    // A burst is already in flight — retry once it finishes.
    if (celebrationRetryTimerRef.current) return;
    celebrationRetryTimerRef.current = setTimeout(() => {
      celebrationRetryTimerRef.current = null;
      setCelebrationRetryTick((n) => n + 1);
    }, CELEBRATION_RETRY_MS);
  }, [isActive, selectedSession, celebrationRetryTick]);

  useEffect(
    () => () => {
      if (celebrationRetryTimerRef.current) {
        clearTimeout(celebrationRetryTimerRef.current);
        celebrationRetryTimerRef.current = null;
      }
    },
    [],
  );

  const filteredSessions = useMemo(
    () => sessions.filter((row) => matchesFilter(row, filter)),
    [sessions, filter],
  );

  async function handleSendChallenge() {
    const ok = await sendGamesChallenge(challengeHash, challengeApp);
    if (ok) setChallengeHash('');
  }

  function handleMove(payload: Record<string, unknown>) {
    if (!selectedSession) return;
    const optimistic =
      selectedSession.app_id === 'chess' && typeof payload.m === 'string'
        ? { kind: 'chess' as const, uci: payload.m }
        : selectedSession.app_id === 'ttt' && typeof payload.i === 'number'
          ? { kind: 'ttt' as const, cellIndex: payload.i }
          : undefined;
    void sendGamesAction({
      destHash: selectedSession.contact_hash,
      appId: selectedSession.app_id,
      command: GAMES_CMD.MOVE,
      sessionId: selectedSession.session_id,
      payload,
      optimistic,
    });
  }

  function handleCommand(command: string, payload?: Record<string, unknown>) {
    if (!selectedSession) return;
    void sendGamesAction({
      destHash: selectedSession.contact_hash,
      appId: selectedSession.app_id,
      command,
      sessionId: selectedSession.session_id,
      payload,
    });
  }

  const showResend =
    selectedSession != null &&
    (selectedSession.delivery_state === 'failed' ||
      (lastActionResult != null &&
        !lastActionResult.ok &&
        lastActionResult.session_id === selectedSession.session_id));
  const drawOfferedByOpponent = selectedSession
    ? isGamesDrawOfferFromOpponent(selectedSession)
    : false;
  const drawOfferedBySelf = selectedSession ? isGamesDrawOfferFromSelf(selectedSession) : false;
  const drawPending = drawOfferedByOpponent || drawOfferedBySelf;
  const drawClaimReason =
    selectedSession?.app_id === 'chess'
      ? gamesMetaStr(selectedSession.metadata, 'draw_offer_reason')
      : '';
  const boardDisabled = actionBusy || isGamesDeliveryInFlight(selectedSession?.delivery_state);

  function deliveryChip(session: GameSession): { label: string; color: string } | null {
    const state = session.delivery_state;
    if (!state || state === 'idle' || state === 'delivered') return null;
    if (state === 'pending' || state === 'sending') {
      return { label: t('gamesPanel.delivery.sending'), color: 'text-cyan-300' };
    }
    if (state === 'propagating') {
      return { label: t('gamesPanel.delivery.propagating'), color: 'text-amber-300' };
    }
    if (state === 'propagated') {
      return { label: t('gamesPanel.delivery.propagated'), color: 'text-amber-200/70' };
    }
    if (state === 'failed') {
      return { label: t('gamesPanel.delivery.failed'), color: 'text-red-300' };
    }
    return null;
  }

  return (
    <div className="bg-primary-dark flex h-full w-full min-w-0 text-amber-50">
      <aside className="flex w-72 shrink-0 flex-col border-r border-amber-800/40">
        <div className="border-b border-amber-800/40 p-3">
          <h2 className="text-sm font-semibold text-amber-100">{t('gamesPanel.title')}</h2>
          <div className="mt-2 flex flex-wrap gap-1">
            {GAMES_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`rounded px-2 py-1 text-xs ${
                  filter === f ? 'bg-amber-800 text-amber-50' : 'bg-amber-950/40 text-amber-200/70'
                }`}
                aria-label={t(`gamesPanel.filters.${f}`)}
                onClick={() => {
                  setFilter(f);
                }}
              >
                {t(`gamesPanel.filters.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredSessions.length === 0 ? (
            <div className="p-3 text-xs text-amber-200/50">{t('gamesPanel.noSessions')}</div>
          ) : (
            <ul>
              {filteredSessions.map((session) => (
                <li key={session.session_id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 border-b border-amber-900/30 px-3 py-2 text-left text-xs hover:bg-amber-950/40 ${
                      selectedSessionId === session.session_id ? 'bg-amber-950/60' : ''
                    }`}
                    aria-label={t('gamesPanel.sessionRowAria', {
                      app: t(`gamesPanel.apps.${session.app_id}`, {
                        defaultValue: session.app_id,
                      }),
                      peer: sessionPeerLabel(session),
                    })}
                    onClick={() => {
                      selectSession(session.session_id);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-amber-100">
                        {t(`gamesPanel.apps.${session.app_id}`, {
                          defaultValue: session.app_id,
                        })}
                      </span>
                      <span className="ml-1 text-amber-200/50">{sessionPeerLabel(session)}</span>
                    </span>
                    <span className="text-amber-200/50">
                      {t(`gamesPanel.status.${session.status}`, {
                        defaultValue: session.status,
                      })}
                    </span>
                    {session.unread > 0 && (
                      <span
                        className="rounded-full bg-red-600 px-1.5 text-[10px] text-white"
                        aria-label={t('gamesPanel.unreadBadgeAria', { count: session.unread })}
                      >
                        {session.unread}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-amber-800/40 p-3">
          <h3 className="mb-1 text-xs font-semibold text-amber-200">
            {t('gamesPanel.newChallenge')}
          </h3>
          <input
            type="text"
            className="w-full rounded border border-amber-800/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-100"
            placeholder={t('gamesPanel.peerHashPlaceholder')}
            aria-label={t('gamesPanel.peerHashAria')}
            value={challengeHash}
            onChange={(e) => {
              setChallengeHash(e.target.value);
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <select
              className="rounded border border-amber-800/50 bg-amber-950/40 px-2 py-1 text-xs text-amber-100"
              aria-label={t('gamesPanel.selectAppAria')}
              value={challengeApp}
              onChange={(e) => {
                setChallengeApp(e.target.value as GamesAppId);
              }}
            >
              {CHALLENGE_APPS.map((appId) => (
                <option key={appId} value={appId}>
                  {t(`gamesPanel.apps.${appId}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="flex-1 rounded bg-amber-800 px-2 py-1 text-xs font-medium text-amber-50 disabled:opacity-50"
              aria-label={t('gamesPanel.sendChallengeAria')}
              disabled={actionBusy || !challengeHash.trim()}
              onClick={() => void handleSendChallenge()}
            >
              {t('gamesPanel.sendChallenge')}
            </button>
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6">
        {!selectedSession ? (
          <div className="text-sm text-amber-200/50">{t('gamesPanel.selectSessionPrompt')}</div>
        ) : (
          <>
            <div className="text-xs text-amber-200/60">
              {t('gamesPanel.opponentLabel', { peer: sessionPeerLabel(selectedSession) })}
            </div>
            {(() => {
              const chip = deliveryChip(selectedSession);
              return chip ? (
                <DeliveryStatusBadgeFrame
                  label={chip.label}
                  icon={selectedSession.delivery_state === 'failed' ? '!' : '…'}
                  colorClass={chip.color}
                  tooltip={chip.label}
                />
              ) : null;
            })()}
            <div ref={boardWrapRef} className="flex flex-col items-center">
              {selectedSession.app_id === 'chess' ? (
                <ChessBoard
                  session={selectedSession}
                  disabled={boardDisabled}
                  onMove={(m) => {
                    handleMove({ m });
                  }}
                />
              ) : (
                <TicTacToeBoard
                  session={selectedSession}
                  disabled={boardDisabled}
                  onMove={(i) => {
                    handleMove({ i });
                  }}
                />
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {selectedSession.status === 'pending' &&
                !isGamesSessionInitiator(selectedSession) && (
                  <>
                    <button
                      type="button"
                      className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      aria-label={t('gamesPanel.acceptAria')}
                      disabled={actionBusy}
                      onClick={() => {
                        handleCommand(GAMES_CMD.ACCEPT);
                      }}
                    >
                      {t('gamesPanel.accept')}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-red-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      aria-label={t('gamesPanel.declineAria')}
                      disabled={actionBusy}
                      onClick={() => {
                        handleCommand(GAMES_CMD.DECLINE);
                      }}
                    >
                      {t('gamesPanel.decline')}
                    </button>
                  </>
                )}
              {selectedSession.status === 'active' && (
                <>
                  <button
                    type="button"
                    className="rounded bg-red-900/80 px-3 py-1 text-xs font-medium text-red-100 disabled:opacity-50"
                    aria-label={t('gamesPanel.resignAria')}
                    disabled={actionBusy}
                    onClick={() => {
                      setConfirmResign(true);
                    }}
                  >
                    {t('gamesPanel.resign')}
                  </button>
                  {drawOfferedByOpponent ? (
                    <>
                      <button
                        type="button"
                        className="rounded bg-amber-800 px-3 py-1 text-xs font-medium text-amber-50 disabled:opacity-50"
                        aria-label={t('gamesPanel.acceptDrawAria')}
                        disabled={actionBusy}
                        onClick={() => {
                          handleCommand(GAMES_CMD.DRAW_ACCEPT);
                        }}
                      >
                        {t('gamesPanel.acceptDraw')}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200 disabled:opacity-50"
                        aria-label={t('gamesPanel.declineDrawAria')}
                        disabled={actionBusy}
                        onClick={() => {
                          handleCommand(GAMES_CMD.DRAW_DECLINE);
                        }}
                      >
                        {t('gamesPanel.declineDraw')}
                      </button>
                    </>
                  ) : drawPending ? null : drawClaimReason === GAMES_DRAW_CLAIM.THREEFOLD ? (
                    <button
                      type="button"
                      className="rounded bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200 disabled:opacity-50"
                      aria-label={t('gamesPanel.claimThreefoldAria')}
                      disabled={actionBusy}
                      onClick={() => {
                        handleCommand(GAMES_CMD.DRAW_OFFER, { r: GAMES_DRAW_CLAIM.THREEFOLD });
                      }}
                    >
                      {t('gamesPanel.claimThreefold')}
                    </button>
                  ) : drawClaimReason === GAMES_DRAW_CLAIM.FIFTY_MOVE ? (
                    <button
                      type="button"
                      className="rounded bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200 disabled:opacity-50"
                      aria-label={t('gamesPanel.claimFiftyMoveAria')}
                      disabled={actionBusy}
                      onClick={() => {
                        handleCommand(GAMES_CMD.DRAW_OFFER, { r: GAMES_DRAW_CLAIM.FIFTY_MOVE });
                      }}
                    >
                      {t('gamesPanel.claimFiftyMove')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200 disabled:opacity-50"
                      aria-label={t('gamesPanel.offerDrawAria')}
                      disabled={actionBusy}
                      onClick={() => {
                        handleCommand(GAMES_CMD.DRAW_OFFER);
                      }}
                    >
                      {t('gamesPanel.offerDraw')}
                    </button>
                  )}
                </>
              )}
              {showResend && (
                <button
                  type="button"
                  className="rounded bg-cyan-800 px-3 py-1 text-xs font-medium text-cyan-50 disabled:opacity-50"
                  aria-label={t('gamesPanel.resendAria')}
                  disabled={actionBusy}
                  onClick={() => void resendGamesAction(selectedSession.session_id)}
                >
                  {t('gamesPanel.resend')}
                </button>
              )}
              <button
                type="button"
                className="rounded bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200/70 disabled:opacity-50"
                aria-label={t('gamesPanel.deleteSessionAria')}
                disabled={actionBusy}
                onClick={() => {
                  setConfirmDelete(true);
                }}
              >
                {t('gamesPanel.deleteSession')}
              </button>
            </div>
          </>
        )}
      </main>
      {confirmResign && selectedSession && (
        <ConfirmModal
          title={t('gamesPanel.resignConfirmTitle')}
          message={t('gamesPanel.resignConfirmMessage')}
          confirmLabel={t('gamesPanel.resign')}
          danger
          onCancel={() => {
            setConfirmResign(false);
          }}
          onConfirm={() => {
            setConfirmResign(false);
            handleCommand(GAMES_CMD.RESIGN);
          }}
        />
      )}
      {confirmDelete && selectedSession && (
        <ConfirmModal
          title={t('gamesPanel.deleteConfirmTitle')}
          message={t('gamesPanel.deleteConfirmMessage')}
          confirmLabel={t('gamesPanel.deleteSession')}
          danger
          onCancel={() => {
            setConfirmDelete(false);
          }}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteGamesSession(selectedSession.session_id);
          }}
        />
      )}
    </div>
  );
}
