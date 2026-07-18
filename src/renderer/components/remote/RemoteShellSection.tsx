import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { RemotePathCapabilityChip } from '@/renderer/components/remote/RemotePathCapabilityChip';
import { RemoteXtermView } from '@/renderer/components/remote/RemoteXtermView';
import { useToast } from '@/renderer/components/Toast';
import { useRemotePathCapability } from '@/renderer/hooks/useRemotePathCapability';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { RemoteSettings } from '@/renderer/lib/remoteSettingsStorage';
import { parseReticulumDestinationInput } from '@/renderer/lib/reticulum/reticulumDestinationInput';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { MAX_RNSH_SESSIONS, useRnshSessionStore } from '@/renderer/stores/rnshSessionStore';

interface PendingFingerprint {
  sessionId: string;
  destinationHash: string;
  identityHash?: string;
  fingerprint?: string;
}

interface ConfirmedFingerprint {
  identityHash?: string;
  fingerprint?: string;
}

/** Session tab status dot color; closed/error fall back to red. */
const SESSION_STATUS_DOT_CLASS: Partial<Record<string, string>> = {
  active: 'bg-green-500',
  connecting: 'bg-amber-400',
};

export interface RemoteShellSectionProps {
  sidecarRunning: boolean;
  settings: RemoteSettings;
  /** False while the Remote tab itself is hidden — skips xterm `fit()` until it regains layout. */
  isActive: boolean;
}

/** Reticulum Remote → Shell: rnsh connect + multi-session terminal tabs. */
export function RemoteShellSection({
  sidecarRunning,
  settings,
  isActive,
}: Readonly<RemoteShellSectionProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const sessions = useRnshSessionStore((s) => s.sessions);
  const focusedSessionId = useRnshSessionStore((s) => s.focusedSessionId);
  const setFocusedSession = useRnshSessionStore((s) => s.setFocusedSession);
  const addSession = useRnshSessionStore((s) => s.addSession);
  const removeSession = useRnshSessionStore((s) => s.removeSession);
  const setDisconnectIntent = useRnshSessionStore((s) => s.setDisconnectIntent);
  const savedAddresses = useReticulumRemoteAddressStore((s) => s.addresses);
  const rnshAddresses = useMemo(
    () => [...savedAddresses.values()].filter((a) => a.service === 'rnsh'),
    [savedAddresses],
  );

  const [addressInput, setAddressInput] = useState('');
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pendingFingerprint, setPendingFingerprint] = useState<PendingFingerprint | null>(null);

  const parsedHash = parseReticulumDestinationInput(addressInput);
  const { capability, loading: capabilityLoading } = useRemotePathCapability(parsedHash);

  const typeaheadMatches = useMemo(() => {
    const q = addressInput.trim().toLowerCase();
    if (!q) return [];
    return rnshAddresses
      .filter((a) => a.label.toLowerCase().includes(q) || a.destination_hash.includes(q))
      .slice(0, 8);
  }, [addressInput, rnshAddresses]);

  const sessionList = useMemo(() => [...sessions.values()], [sessions]);

  const confirmedFingerprintsRef = useRef(new Map<string, ConfirmedFingerprint>());

  const finalizeConnect = useCallback(
    async (
      destinationHash: string,
      opts?: { autoReconnect?: boolean; reconnectAttempts?: number },
    ) => {
      setConnecting(true);
      try {
        const res = await window.electronAPI.reticulum.rnsh.connect({
          destination_hash: destinationHash,
        });
        if (!res.ok || !res.session_id) {
          addToast(
            t('reticulumRemote.shell.connectFailed', { error: res.error ?? t('common.error') }),
            'error',
          );
          return;
        }
        const known = confirmedFingerprintsRef.current.get(destinationHash);
        const sameIdentity =
          opts?.autoReconnect &&
          known != null &&
          (known.identityHash ?? '') === (res.identity_hash ?? '') &&
          (known.fingerprint ?? '') === (res.fingerprint ?? '');
        const reconnectAttempts = opts?.reconnectAttempts ?? 0;
        if (sameIdentity) {
          // Previously confirmed identity for this destination — reconnect without re-prompting.
          // Seed reconnectAttempts so the auto-reconnect cap survives session_id churn.
          addSession(res.session_id, destinationHash, { reconnectAttempts });
          setFocusedSession(res.session_id);
          return;
        }
        setPendingFingerprint({
          sessionId: res.session_id,
          destinationHash,
          identityHash: res.identity_hash,
          fingerprint: res.fingerprint,
        });
      } catch (e) {
        console.debug('[RemoteShellSection] connect ' + errLikeToLogString(e));
        addToast(
          t('reticulumRemote.shell.connectFailed', { error: errLikeToLogString(e) }),
          'error',
        );
      } finally {
        setConnecting(false);
      }
    },
    [addSession, addToast, setFocusedSession, t],
  );

  const handleConnectClick = useCallback(() => {
    if (!parsedHash) {
      addToast(t('reticulumRemote.errors.invalidAddress'), 'error');
      return;
    }
    if (sessions.size >= MAX_RNSH_SESSIONS) {
      addToast(t('reticulumRemote.shell.maxSessions', { count: MAX_RNSH_SESSIONS }), 'error');
      return;
    }
    setShowTypeahead(false);
    void finalizeConnect(parsedHash);
  }, [addToast, finalizeConnect, parsedHash, sessions.size, t]);

  const confirmFingerprint = useCallback(() => {
    if (!pendingFingerprint) return;
    confirmedFingerprintsRef.current.set(pendingFingerprint.destinationHash, {
      identityHash: pendingFingerprint.identityHash,
      fingerprint: pendingFingerprint.fingerprint,
    });
    addSession(pendingFingerprint.sessionId, pendingFingerprint.destinationHash);
    setFocusedSession(pendingFingerprint.sessionId);
    setAddressInput('');
    setPendingFingerprint(null);
  }, [addSession, pendingFingerprint, setFocusedSession]);

  const rejectFingerprint = useCallback(() => {
    if (!pendingFingerprint) return;
    void window.electronAPI.reticulum.rnsh
      .disconnect({ session_id: pendingFingerprint.sessionId })
      .catch((e: unknown) => {
        console.debug('[RemoteShellSection] reject-disconnect ' + errLikeToLogString(e));
      });
    setPendingFingerprint(null);
  }, [pendingFingerprint]);

  const handleDisconnect = useCallback(
    async (sessionId: string) => {
      setDisconnectIntent(sessionId, true);
      try {
        await window.electronAPI.reticulum.rnsh.disconnect({ session_id: sessionId });
      } catch (e) {
        console.warn('[RemoteShellSection] disconnect ' + errLikeToLogString(e));
      } finally {
        removeSession(sessionId);
      }
    },
    [removeSession, setDisconnectIntent],
  );

  const handleReconnect = useCallback(
    async (sessionId: string, destinationHash: string, opts?: { autoReconnect?: boolean }) => {
      // Read attempt count before removeSession — increment after remove is a no-op.
      const prior = useRnshSessionStore.getState().getSession(sessionId)?.reconnectAttempts ?? 0;
      const nextAttempts = prior + 1;
      removeSession(sessionId);
      await finalizeConnect(destinationHash, {
        ...opts,
        reconnectAttempts: nextAttempts,
      });
    },
    [finalizeConnect, removeSession],
  );

  // Auto-reconnect once per unexpected closed/error session, up to the configured cap.
  // Only reconnects silently when the reconnect response's identity/fingerprint matches the
  // last user-confirmed value for that destination — otherwise it falls back to a fresh
  // fingerprint prompt so a changed remote identity is never trusted implicitly.
  // Gate by destination_hash (not session_id): each reconnect allocates a new session_id, so
  // a session_id gate would never trip the maxReconnectAttempts cap.
  const autoReconnectedDestRef = useRef(new Set<string>());
  useEffect(() => {
    if (!settings.autoReconnectShell) return;
    for (const session of sessionList) {
      if (session.disconnectIntent) continue;
      if (session.status !== 'closed' && session.status !== 'error') continue;
      if (session.reconnectAttempts >= settings.maxReconnectAttempts) continue;
      const dest = session.destination_hash;
      if (autoReconnectedDestRef.current.has(dest)) continue;
      autoReconnectedDestRef.current.add(dest);
      void handleReconnect(session.session_id, dest, { autoReconnect: true }).finally(() => {
        autoReconnectedDestRef.current.delete(dest);
      });
    }
  }, [sessionList, settings.autoReconnectShell, settings.maxReconnectAttempts, handleReconnect]);

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 p-3">
      <div className="relative flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <input
            type="text"
            value={addressInput}
            onChange={(e) => {
              setAddressInput(e.target.value);
              setShowTypeahead(true);
            }}
            onFocus={() => {
              setShowTypeahead(true);
            }}
            onBlur={() => {
              setShowTypeahead(false);
            }}
            placeholder={t('reticulumRemote.shell.addressPlaceholder')}
            aria-label={t('reticulumRemote.shell.addressAria')}
            className="bg-secondary-dark/80 w-full rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none"
          />
          {showTypeahead && typeaheadMatches.length > 0 && (
            <ul className="bg-secondary-dark absolute z-10 mt-1 w-full rounded-lg border border-gray-600/50 shadow-lg">
              {typeaheadMatches.map((addr) => (
                <li key={addr.id}>
                  <button
                    type="button"
                    aria-label={t('reticulumRemote.shell.selectSavedAddress', {
                      label: addr.label,
                    })}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-700/60"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setAddressInput(addr.destination_hash);
                      setShowTypeahead(false);
                    }}
                  >
                    <span className="font-medium">{addr.label}</span>{' '}
                    <span className="text-muted text-xs">{addr.destination_hash}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <RemotePathCapabilityChip capability={capability} loading={capabilityLoading} />
        <button
          type="button"
          disabled={!sidecarRunning || !parsedHash || connecting}
          aria-label={t('reticulumRemote.shell.connectAria')}
          onClick={handleConnectClick}
          className="rounded-lg bg-blue-700/80 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {connecting ? t('reticulumRemote.shell.connecting') : t('reticulumRemote.shell.connect')}
        </button>
      </div>

      {sessionList.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-700/60 pb-1">
          {sessionList.map((session) => (
            <div
              key={session.session_id}
              className={`flex items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1 text-xs ${
                session.session_id === focusedSessionId
                  ? 'border-blue-600/60 bg-blue-900/30 text-blue-200'
                  : 'border-gray-700/60 bg-gray-800/40 text-gray-400'
              }`}
            >
              <button
                type="button"
                aria-label={t('reticulumRemote.shell.focusSession', {
                  address: session.destination_hash.slice(0, 8),
                })}
                onClick={() => {
                  setFocusedSession(session.session_id);
                }}
                className="flex items-center gap-1"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${SESSION_STATUS_DOT_CLASS[session.status] ?? 'bg-red-500'}`}
                  aria-hidden="true"
                />
                {session.destination_hash.slice(0, 8)}
              </button>
              <button
                type="button"
                aria-label={t('reticulumRemote.shell.closeSession', {
                  address: session.destination_hash.slice(0, 8),
                })}
                onClick={() => void handleDisconnect(session.session_id)}
                className="ml-1 text-gray-500 hover:text-gray-200"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {sessionList.length === 0 ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">
            {t('reticulumRemote.shell.emptyState')}
          </div>
        ) : (
          sessionList.map((session) => (
            <div
              key={session.session_id}
              hidden={session.session_id !== focusedSessionId}
              className="flex h-full min-h-0 flex-col gap-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                <span>{t(`reticulumRemote.shell.status.${session.status}`)}</span>
                <div className="flex gap-2">
                  {session.status !== 'active' && session.status !== 'connecting' && (
                    <button
                      type="button"
                      aria-label={t('reticulumRemote.shell.reconnectAria')}
                      onClick={() => {
                        // eslint-disable-next-line react-hooks/refs -- event handler, not render; reconnect reads the confirmed-fingerprint ref to skip re-prompting
                        void handleReconnect(session.session_id, session.destination_hash);
                      }}
                      className="rounded bg-gray-700/60 px-2 py-1 text-gray-200 hover:bg-gray-600"
                    >
                      {t('reticulumRemote.shell.reconnect')}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t('reticulumRemote.shell.disconnectAria')}
                    onClick={() => void handleDisconnect(session.session_id)}
                    className="rounded bg-red-900/50 px-2 py-1 text-red-300 hover:bg-red-900/70"
                  >
                    {t('reticulumRemote.shell.disconnect')}
                  </button>
                </div>
              </div>
              {!session.disconnectIntent &&
                (session.status === 'closed' || session.status === 'error') &&
                settings.autoReconnectShell && (
                  <div className="rounded border border-amber-700/60 bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200">
                    {session.reconnectAttempts >= settings.maxReconnectAttempts
                      ? t('reticulumRemote.shell.reconnectExhausted')
                      : t('reticulumRemote.shell.reconnectingBanner', {
                          attempt: session.reconnectAttempts,
                          max: settings.maxReconnectAttempts,
                        })}
                  </div>
                )}
              <div className="min-h-0 flex-1">
                <RemoteXtermView
                  sessionId={session.session_id}
                  hidden={session.session_id !== focusedSessionId || !isActive}
                  readOnly={session.status !== 'active'}
                  onInputBase64={(data) => {
                    void window.electronAPI.reticulum.rnsh
                      .input({ session_id: session.session_id, data, encoding: 'base64' })
                      .catch((e: unknown) => {
                        console.debug('[RemoteShellSection] input ' + errLikeToLogString(e));
                      });
                  }}
                  onResize={(rows, cols) => {
                    void window.electronAPI.reticulum.rnsh
                      .resize({ session_id: session.session_id, rows, cols })
                      .catch((e: unknown) => {
                        console.debug('[RemoteShellSection] resize ' + errLikeToLogString(e));
                      });
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {pendingFingerprint && (
        <ConfirmModal
          title={t('reticulumRemote.shell.fingerprintTitle')}
          message={t('reticulumRemote.shell.fingerprintMessage', {
            address: pendingFingerprint.destinationHash,
            identity: pendingFingerprint.identityHash ?? t('reticulumRemote.shell.unknownIdentity'),
            fingerprint:
              pendingFingerprint.fingerprint ?? t('reticulumRemote.shell.unknownFingerprint'),
          })}
          confirmLabel={t('reticulumRemote.shell.fingerprintConfirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={confirmFingerprint}
          onCancel={rejectFingerprint}
        />
      )}
    </div>
  );
}
