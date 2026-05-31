import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMeshcoreRoomAuth } from '@/renderer/hooks/useMeshcoreRoomAuth';
import { MESHCORE_PAYLOAD_LIMIT } from '@/renderer/lib/chatComposerLimits';
import {
  loadPersistedRoomsLastRead,
  mergeRoomLastReadWatermark,
  notifyPersistedRoomsLastReadChanged,
  savePersistedRoomsLastRead,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { CliHistoryEntry } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import {
  getMeshcoreRoomCredential,
  listMeshcoreRoomCredentialNodeIds,
} from '@/renderer/lib/meshcoreRoomCredentialStorage';
import {
  MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD,
  meshcoreClearRoomSession,
  meshcoreGetRoomSession,
  meshcoreIsRoomLoggedIn,
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomCanPost,
  meshcoreRoomEffectiveGuestPassword,
} from '@/renderer/lib/meshcoreRoomSession';
import { computeRoomUnreadCounts } from '@/renderer/lib/meshcoreRoomsUnread';
import {
  getMeshcoreRoomLastPostAt,
  getMeshcoreRoomSyncConfig,
  setMeshcoreRoomSyncConfig,
} from '@/renderer/lib/meshcoreRoomSyncStorage';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

import { ChatComposer } from './ChatComposer';
import { ChatPayloadText } from './ChatPayloadText';
import { MessageStatusBadge } from './MessageStatusBadge';

interface Props {
  nodes: Map<number, MeshNode>;
  messages: ChatMessage[];
  myNodeNum: number;
  isConnected: boolean;
  connectionType?: 'ble' | 'serial' | 'http' | null;
  /** True when the Rooms tab panel is visible (for mark-read while viewing). */
  isActive?: boolean;
  initialRoomTarget?: number | null;
  onInitialRoomConsumed?: () => void;
  onLoginRoom: (
    nodeId: number,
    password: string,
    opts?: {
      adminPassword?: string;
      guestPassword?: string;
      rememberPassword?: boolean;
    },
  ) => Promise<void>;
  onLoginRoomWithSaved: (nodeId: number) => Promise<void>;
  onCancelRoomLogin: (nodeId: number) => void;
  onSendRoomPost: (nodeId: number, text: string) => Promise<void>;
  onSendRoomAdminCli: (nodeId: number, command: string) => Promise<string>;
  meshcoreCliHistories?: Map<number, CliHistoryEntry[]>;
  meshcoreCliErrors?: Map<number, string>;
  onClearCliHistory?: (nodeId: number) => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function RoomsPanel({
  nodes,
  messages,
  myNodeNum,
  isConnected,
  connectionType,
  isActive = false,
  initialRoomTarget,
  onInitialRoomConsumed,
  onLoginRoom,
  onLoginRoomWithSaved,
  onCancelRoomLogin,
  onSendRoomPost,
  onSendRoomAdminCli,
  meshcoreCliHistories,
  meshcoreCliErrors,
  onClearCliHistory,
}: Props) {
  const { t } = useTranslation();
  const { ensureRoomAuth, RemoteAuthModal } = useMeshcoreRoomAuth();
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [loginPassword, setLoginPassword] = useState(MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD);
  const [loginLoadingRoomIds, setLoginLoadingRoomIds] = useState<Set<number>>(() => new Set());
  const [loginErrorsByRoom, setLoginErrorsByRoom] = useState<Map<number, string>>(() => new Map());
  const [manageOpen, setManageOpen] = useState(false);
  const [cliInput, setCliInput] = useState('');
  const [cliPending, setCliPending] = useState(false);
  const [aclPubkey, setAclPubkey] = useState('');
  const [aclLevel, setAclLevel] = useState(1);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [syncConfigDirty, setSyncConfigDirty] = useState(false);
  const [storedRoomIds, setStoredRoomIds] = useState<Set<number>>(
    () => new Set(listMeshcoreRoomCredentialNodeIds()),
  );
  const autoLoginAttempted = useRef<Set<number>>(new Set());
  const loginAttemptGenRef = useRef<Map<number, number>>(new Map());
  const streamRef = useRef<HTMLDivElement>(null);
  const [persistedRoomsLastRead, setPersistedRoomsLastRead] = useState(() =>
    loadPersistedRoomsLastRead(),
  );

  const ownNodeIdSet = useMemo(
    () => (myNodeNum > 0 ? new Set([myNodeNum]) : new Set<number>()),
    [myNodeNum],
  );

  const refreshStoredRooms = useCallback(() => {
    setStoredRoomIds(new Set(listMeshcoreRoomCredentialNodeIds()));
  }, []);

  const roomServers = useMemo(
    () =>
      Array.from(nodes.values())
        .filter((n) => n.hw_model === 'Room')
        .sort((a, b) => (a.long_name ?? '').localeCompare(b.long_name ?? '')),
    [nodes],
  );

  const activeRoom = selectedRoomId != null ? nodes.get(selectedRoomId) : undefined;

  const roomPosts = useMemo(() => {
    if (selectedRoomId == null) return [];
    return messages
      .filter((m) => m.roomServerId === selectedRoomId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [messages, selectedRoomId]);

  const newestPostTs = useMemo(() => {
    if (roomPosts.length === 0) {
      if (selectedRoomId == null) return null;
      return getMeshcoreRoomLastPostAt(selectedRoomId);
    }
    return Math.max(...roomPosts.map((m) => m.timestamp));
  }, [roomPosts, selectedRoomId]);

  const lastSyncAt =
    selectedRoomId != null ? getMeshcoreRoomSyncConfig(selectedRoomId).lastSyncAt : null;

  const postCountByRoom = useMemo(() => {
    const counts = new Map<number, number>();
    for (const m of messages) {
      if (m.roomServerId == null) continue;
      counts.set(m.roomServerId, (counts.get(m.roomServerId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  const roomUnreadCounts = useMemo(
    () => computeRoomUnreadCounts(messages, persistedRoomsLastRead, ownNodeIdSet),
    [messages, ownNodeIdSet, persistedRoomsLastRead],
  );

  const markSelectedRoomRead = useCallback(() => {
    if (selectedRoomId == null || roomPosts.length === 0) return;
    const latest = Math.max(...roomPosts.map((m) => m.timestamp));
    setPersistedRoomsLastRead((prev) => {
      const next = mergeRoomLastReadWatermark(prev, selectedRoomId, latest);
      if (next === prev) return prev;
      savePersistedRoomsLastRead(next);
      notifyPersistedRoomsLastReadChanged();
      return next;
    });
  }, [roomPosts, selectedRoomId]);

  const handleStreamScroll = useCallback(() => {
    const el = streamRef.current;
    if (!el || !isActive) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 50) {
      markSelectedRoomRead();
    }
  }, [isActive, markSelectedRoomRead]);

  useEffect(() => {
    if (initialRoomTarget != null) {
      setSelectedRoomId(initialRoomTarget);
      onInitialRoomConsumed?.();
    }
  }, [initialRoomTarget, onInitialRoomConsumed]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [roomPosts.length, selectedRoomId]);

  useEffect(() => {
    if (!isActive || selectedRoomId == null || !meshcoreIsRoomLoggedIn(selectedRoomId)) return;
    const el = streamRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 50) {
      markSelectedRoomRead();
    }
  }, [isActive, markSelectedRoomRead, roomPosts.length, selectedRoomId]);

  const loadSyncConfig = useCallback((nodeId: number) => {
    const config = getMeshcoreRoomSyncConfig(nodeId);
    setSyncEnabled(config.enabled);
    setSyncInterval(config.intervalMinutes);
    setSyncConfigDirty(false);
  }, []);

  const handleSelectRoom = useCallback(
    (nodeId: number) => {
      setSelectedRoomId(nodeId);
      setLoginErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      setLoginPassword(MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD);
      setRememberPassword(false);
      setManageOpen(false);
      loadSyncConfig(nodeId);
    },
    [loadSyncConfig],
  );

  const startRoomLogin = useCallback(
    (nodeId: number, loginFn: () => Promise<void>) => {
      const gen = (loginAttemptGenRef.current.get(nodeId) ?? 0) + 1;
      loginAttemptGenRef.current.set(nodeId, gen);
      setLoginLoadingRoomIds((prev) => new Set(prev).add(nodeId));
      setLoginErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      void loginFn()
        .then(() => {
          if (loginAttemptGenRef.current.get(nodeId) !== gen) return;
          refreshStoredRooms();
        })
        .catch((e: unknown) => {
          if (loginAttemptGenRef.current.get(nodeId) !== gen) return;
          if (meshcoreIsRoomLoginAbortError(e)) return;
          setLoginErrorsByRoom((prev) =>
            new Map(prev).set(nodeId, e instanceof Error ? e.message : t('roomsPanel.loginFailed')),
          );
        })
        .finally(() => {
          if (loginAttemptGenRef.current.get(nodeId) !== gen) return;
          setLoginLoadingRoomIds((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        });
    },
    [refreshStoredRooms, t],
  );

  const handleCancelLogin = useCallback(() => {
    if (selectedRoomId == null) return;
    onCancelRoomLogin(selectedRoomId);
    autoLoginAttempted.current.delete(selectedRoomId);
    loginAttemptGenRef.current.set(
      selectedRoomId,
      (loginAttemptGenRef.current.get(selectedRoomId) ?? 0) + 1,
    );
    setLoginLoadingRoomIds((prev) => {
      if (!prev.has(selectedRoomId)) return prev;
      const next = new Set(prev);
      next.delete(selectedRoomId);
      return next;
    });
  }, [onCancelRoomLogin, selectedRoomId]);

  useEffect(() => {
    if (selectedRoomId == null || !isConnected) return;
    if (meshcoreIsRoomLoggedIn(selectedRoomId)) return;
    if (autoLoginAttempted.current.has(selectedRoomId)) return;
    if (!getMeshcoreRoomCredential(selectedRoomId)) return;
    autoLoginAttempted.current.add(selectedRoomId);
    startRoomLogin(selectedRoomId, () => onLoginRoomWithSaved(selectedRoomId));
  }, [isConnected, onLoginRoomWithSaved, selectedRoomId, startRoomLogin]);

  const handleLogin = useCallback(() => {
    if (selectedRoomId == null) return;
    const nodeId = selectedRoomId;
    const password = meshcoreRoomEffectiveGuestPassword(loginPassword);
    startRoomLogin(nodeId, async () => {
      await onLoginRoom(nodeId, password, {
        guestPassword: password,
        adminPassword: '',
        rememberPassword,
      });
      if (rememberPassword) refreshStoredRooms();
      setLoginPassword(MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD);
    });
  }, [
    loginPassword,
    onLoginRoom,
    rememberPassword,
    refreshStoredRooms,
    selectedRoomId,
    startRoomLogin,
  ]);

  const handleReadOnlyLogin = useCallback(() => {
    if (selectedRoomId == null) return;
    const nodeId = selectedRoomId;
    startRoomLogin(nodeId, () =>
      onLoginRoom(nodeId, '', {
        guestPassword: '',
        adminPassword: '',
      }),
    );
  }, [onLoginRoom, selectedRoomId, startRoomLogin]);

  const handleSaveSyncConfig = useCallback(async () => {
    if (selectedRoomId == null) return;
    await setMeshcoreRoomSyncConfig(selectedRoomId, {
      enabled: syncEnabled,
      intervalMinutes: syncInterval,
    });
    setSyncConfigDirty(false);
  }, [selectedRoomId, syncEnabled, syncInterval]);

  const roomViewKey = selectedRoomId != null ? `room:${selectedRoomId}` : 'room:none';

  const mentionNodes = useMemo(() => {
    const map = new Map<number, MeshNode>();
    for (const n of nodes.values()) {
      map.set(n.node_id, n);
    }
    for (const m of roomPosts) {
      if (!map.has(m.sender_id)) {
        map.set(m.sender_id, {
          node_id: m.sender_id,
          long_name: m.sender_name,
          short_name: '',
          hw_model: '',
          battery: 0,
          snr: 0,
          rssi: 0,
          last_heard: 0,
          latitude: null,
          longitude: null,
        });
      }
    }
    return map;
  }, [nodes, roomPosts]);

  const handleSendChunk = useCallback(
    async (text: string) => {
      if (selectedRoomId == null) return;
      await onSendRoomPost(selectedRoomId, text);
    },
    [onSendRoomPost, selectedRoomId],
  );

  const handleLeaveRoom = useCallback(() => {
    if (selectedRoomId == null) return;
    meshcoreClearRoomSession(selectedRoomId);
    setManageOpen(false);
    setLoginErrorsByRoom((prev) => {
      if (!prev.has(selectedRoomId)) return prev;
      const next = new Map(prev);
      next.delete(selectedRoomId);
      return next;
    });
  }, [selectedRoomId]);

  const handleAdminLogin = useCallback(async () => {
    if (selectedRoomId == null) return;
    if (manageOpen) {
      setManageOpen(false);
      return;
    }
    const nodeId = selectedRoomId;
    const auth = await ensureRoomAuth(
      nodeId,
      'admin',
      activeRoom?.long_name ?? `Room-${nodeId.toString(16)}`,
    );
    if (!auth.ok) return;
    const adminPassword = auth.adminPassword.trim();
    const guestPassword = auth.guestPassword.trim();
    if (!adminPassword) {
      setLoginErrorsByRoom((prev) =>
        new Map(prev).set(nodeId, t('roomsPanel.adminPasswordRequired')),
      );
      return;
    }
    startRoomLogin(nodeId, async () => {
      await onLoginRoom(nodeId, adminPassword, { adminPassword, guestPassword });
      setManageOpen(true);
    });
  }, [
    activeRoom?.long_name,
    ensureRoomAuth,
    manageOpen,
    onLoginRoom,
    selectedRoomId,
    startRoomLogin,
    t,
  ]);

  useEffect(() => {
    if (!manageOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManageOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [manageOpen]);

  const handleCliSend = useCallback(async () => {
    if (selectedRoomId == null || !cliInput.trim()) return;
    setCliPending(true);
    try {
      await onSendRoomAdminCli(selectedRoomId, cliInput.trim());
      setCliInput('');
    } catch (e) {
      console.warn('[RoomsPanel] admin CLI failed ' + errLikeToLogString(e));
    } finally {
      setCliPending(false);
    }
  }, [cliInput, onSendRoomAdminCli, selectedRoomId]);

  const handleAclSubmit = useCallback(
    async (e: React.SubmitEvent) => {
      e.preventDefault();
      const normalized = aclPubkey.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(normalized)) return;
      await onSendRoomAdminCli(selectedRoomId!, `setperm ${normalized} ${aclLevel}`);
      setAclPubkey('');
    },
    [aclLevel, aclPubkey, onSendRoomAdminCli, selectedRoomId],
  );

  const loggedIn = selectedRoomId != null && meshcoreIsRoomLoggedIn(selectedRoomId);
  const guestFieldEmpty = loginPassword.trim().length === 0;
  const selectedRoomLoginLoading =
    selectedRoomId != null && loginLoadingRoomIds.has(selectedRoomId);
  const loginError =
    selectedRoomId != null ? (loginErrorsByRoom.get(selectedRoomId) ?? null) : null;
  const canPost = selectedRoomId != null && meshcoreRoomCanPost(selectedRoomId);
  const sessionRole = selectedRoomId != null ? meshcoreGetRoomSession(selectedRoomId)?.role : null;
  const cliHistory =
    selectedRoomId != null ? (meshcoreCliHistories?.get(selectedRoomId) ?? []) : [];
  const cliError = selectedRoomId != null ? meshcoreCliErrors?.get(selectedRoomId) : undefined;

  return (
    <div className="flex h-full min-h-[28rem] flex-col gap-3">
      {RemoteAuthModal}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="bg-secondary-dark flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-700">
          <div className="border-b border-gray-700 px-3 py-2 text-sm font-medium text-gray-200">
            {t('roomsPanel.title')} <span className="text-gray-500">({roomServers.length})</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {roomServers.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">{t('roomsPanel.noRoomsYet')}</p>
            ) : (
              roomServers.map((room) => {
                const count = postCountByRoom.get(room.node_id) ?? 0;
                const unread = roomUnreadCounts.get(room.node_id) ?? 0;
                const isLogged = meshcoreIsRoomLoggedIn(room.node_id);
                const hasSaved = storedRoomIds.has(room.node_id);
                const isLoggingIn = loginLoadingRoomIds.has(room.node_id);
                return (
                  <button
                    key={room.node_id}
                    type="button"
                    data-unread={unread > 0 && selectedRoomId !== room.node_id ? unread : 0}
                    onClick={() => {
                      handleSelectRoom(room.node_id);
                    }}
                    className={`w-full border-b border-gray-800 px-3 py-2 text-left transition-colors hover:bg-gray-800/60 ${
                      selectedRoomId === room.node_id ? 'bg-gray-800/80' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-200">
                      <span
                        className={
                          isLogged
                            ? 'text-brand-green'
                            : isLoggingIn
                              ? 'text-amber-300'
                              : hasSaved
                                ? 'text-amber-400/90'
                                : 'text-gray-500'
                        }
                        aria-hidden
                      >
                        {isLogged ? '●' : isLoggingIn ? '◌' : hasSaved ? '◐' : '○'}
                      </span>
                      <span className="truncate">{room.long_name}</span>
                      {unread > 0 && selectedRoomId !== room.node_id && (
                        <span className="ml-auto shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 pl-5 text-xs text-gray-500">
                      {t('roomsPanel.postCount', { count })}
                      {unread > 0 && selectedRoomId !== room.node_id && (
                        <>
                          {' '}
                          · {t('roomsPanel.unreadPosts', { count: unread > 99 ? '99+' : unread })}
                        </>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-secondary-dark relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-700">
          {!selectedRoomId && (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
              {t('roomsPanel.selectRoom')}
            </div>
          )}

          {selectedRoomId && !loggedIn && !selectedRoomLoginLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 p-4">
              <div className="w-full max-w-sm space-y-3 rounded-lg border border-gray-600 bg-gray-900 p-4">
                <h3 className="text-base font-semibold text-white">{t('roomsPanel.loginTitle')}</h3>
                <p className="text-sm text-gray-400">{activeRoom?.long_name}</p>
                <p className="text-xs text-gray-500">{t('roomsPanel.loginHelp')}</p>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLogin();
                  }}
                  placeholder={t('roomsPanel.guestPasswordPlaceholder')}
                  disabled={!isConnected}
                  className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
                  aria-label={t('roomsPanel.guestPasswordLabel')}
                />
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={rememberPassword}
                    onChange={(e) => {
                      setRememberPassword(e.target.checked);
                    }}
                    disabled={!isConnected}
                  />
                  {t('roomsPanel.rememberPassword')}
                </label>
                {guestFieldEmpty && (
                  <p className="text-xs text-amber-200/90">{t('roomsPanel.emptyGuestLoginHint')}</p>
                )}
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={!isConnected || guestFieldEmpty}
                  className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 w-full rounded border px-3 py-2 text-sm font-medium disabled:opacity-40"
                >
                  {t('roomsPanel.loginButton')}
                </button>
                <button
                  type="button"
                  onClick={handleReadOnlyLogin}
                  disabled={!isConnected}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
                >
                  {t('roomsPanel.continueReadOnly')}
                </button>
                {loginError && <p className="text-sm text-red-400">{loginError}</p>}
              </div>
            </div>
          )}

          {selectedRoomId && !loggedIn && selectedRoomLoginLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-gray-400">
              <p>{t('roomsPanel.loggingIn')}</p>
              <p className="max-w-xs text-center text-xs text-gray-500">
                {t('roomsPanel.cancelLoginHint')}
              </p>
              <button
                type="button"
                onClick={handleCancelLogin}
                className="rounded border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                aria-label={t('roomsPanel.cancelLogin')}
              >
                {t('roomsPanel.cancelLogin')}
              </button>
            </div>
          )}

          {selectedRoomId && loggedIn && (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-700 px-3 py-2">
                <span className="text-sm font-medium text-gray-200">{activeRoom?.long_name}</span>
                <span className="text-xs text-gray-500">
                  {t('roomsPanel.postCount', { count: roomPosts.length })}
                  {newestPostTs != null && (
                    <>
                      {' '}
                      · {t('roomsPanel.lastPost')}: {formatTimestamp(newestPostTs)}
                    </>
                  )}
                  {lastSyncAt != null && (
                    <>
                      {' '}
                      · {t('roomsPanel.lastSync')}: {formatTimestamp(lastSyncAt)}
                    </>
                  )}
                </span>
                <label
                  className="flex items-center gap-1.5 text-xs text-gray-400"
                  title={t('roomsPanel.autoSyncTooltip')}
                >
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    onChange={(e) => {
                      setSyncEnabled(e.target.checked);
                      setSyncConfigDirty(true);
                    }}
                    aria-label={t('roomsPanel.autoSync')}
                  />
                  {t('roomsPanel.autoSync')}
                </label>
                {syncEnabled && (
                  <select
                    value={syncInterval}
                    onChange={(e) => {
                      setSyncInterval(Number.parseInt(e.target.value, 10));
                      setSyncConfigDirty(true);
                    }}
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-200"
                    aria-label={t('roomsPanel.syncIntervalLabel')}
                  >
                    <option value={60}>{t('roomsPanel.syncInterval60')}</option>
                    <option value={120}>{t('roomsPanel.syncInterval120')}</option>
                    <option value={240}>{t('roomsPanel.syncInterval240')}</option>
                  </select>
                )}
                {syncConfigDirty && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveSyncConfig();
                    }}
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-700"
                    aria-label={t('roomsPanel.saveSyncConfig')}
                  >
                    {t('roomsPanel.saveSyncConfig')}
                  </button>
                )}
                {sessionRole === 'readonly' && (
                  <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-200">
                    {t('roomsPanel.readOnlyBadge')}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={handleLeaveRoom}
                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    aria-label={t('roomsPanel.leaveRoom')}
                  >
                    {t('roomsPanel.leaveRoom')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAdminLogin();
                    }}
                    disabled={!isConnected}
                    className={`rounded border px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40 ${
                      manageOpen
                        ? 'border-brand-green/50 bg-brand-green/20 text-brand-green'
                        : 'border-gray-600 bg-gray-800'
                    }`}
                    aria-pressed={manageOpen}
                  >
                    {t('roomsPanel.manageRoom')}
                  </button>
                </div>
              </div>

              <div
                ref={streamRef}
                onScroll={handleStreamScroll}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
              >
                {roomPosts.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('roomsPanel.noPostsYet')}</p>
                ) : (
                  roomPosts.map((m) => {
                    const isOwn = m.sender_id === myNodeNum;
                    const rowKey =
                      m.roomServerId != null
                        ? `room:${m.roomServerId}:${Math.floor(m.timestamp / 1000)}:${m.sender_id}`
                        : `${m.timestamp}:${m.sender_id}:${m.payload}`;
                    return (
                      <div
                        key={rowKey}
                        className={`group/msg rounded-lg px-3 py-2 text-sm ${
                          isOwn
                            ? 'bg-purple-900/30 text-purple-100'
                            : 'bg-gray-800/60 text-gray-200'
                        }`}
                      >
                        <div className="mb-1 flex items-baseline gap-2 text-xs text-gray-400">
                          <span className="font-medium text-gray-300">{m.sender_name}</span>
                          <span>{formatTimestamp(m.timestamp)}</span>
                          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                            <button
                              type="button"
                              onClick={() => {
                                void writeClipboardText(m.payload).catch((err: unknown) => {
                                  console.warn(
                                    '[RoomsPanel] copy failed ' + errLikeToLogString(err),
                                  );
                                });
                              }}
                              className="rounded p-0.5 text-gray-500 hover:text-gray-300"
                              aria-label={t('chatPanel.copyMessage')}
                              title={t('chatPanel.copyMessage')}
                            >
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="break-words whitespace-pre-wrap">
                          <ChatPayloadText text={m.payload} query="" />
                        </div>
                        {isOwn && m.status && (
                          <div className="mt-0.5 flex items-center justify-end gap-1">
                            {m.status === 'failed' && (
                              <button
                                type="button"
                                onClick={() => {
                                  void onSendRoomPost(selectedRoomId, m.payload);
                                }}
                                className="text-gray-500 transition-colors hover:text-gray-300"
                                title={t('chatPanel.resendMessage')}
                                aria-label={t('chatPanel.resendMessage')}
                              >
                                ↻
                              </button>
                            )}
                            <MessageStatusBadge
                              status={m.status}
                              transport="device"
                              connectionType={connectionType}
                              error={m.error ?? undefined}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t border-gray-700 p-3">
                {!canPost ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-200/90">{t('roomsPanel.readOnlyHint')}</p>
                    <p className="text-xs font-medium text-gray-300">
                      {t('roomsPanel.upgradeAccess')}
                    </p>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !guestFieldEmpty) handleLogin();
                      }}
                      placeholder={t('roomsPanel.guestPasswordPlaceholder')}
                      disabled={!isConnected || selectedRoomLoginLoading}
                      className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
                      aria-label={t('roomsPanel.guestPasswordLabel')}
                    />
                    <label className="flex items-center gap-2 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        checked={rememberPassword}
                        onChange={(e) => {
                          setRememberPassword(e.target.checked);
                        }}
                        disabled={!isConnected || selectedRoomLoginLoading}
                      />
                      {t('roomsPanel.rememberPassword')}
                    </label>
                    {guestFieldEmpty && (
                      <p className="text-xs text-amber-200/90">
                        {t('roomsPanel.emptyGuestLoginHint')}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleLogin}
                      disabled={!isConnected || guestFieldEmpty || selectedRoomLoginLoading}
                      className="bg-brand-green/20 text-brand-green border-brand-green/40 hover:bg-brand-green/30 w-full rounded border px-3 py-2 text-sm font-medium disabled:opacity-40"
                      aria-label={t('roomsPanel.upgradeAccess')}
                    >
                      {selectedRoomLoginLoading
                        ? t('roomsPanel.loggingIn')
                        : t('roomsPanel.upgradeAccess')}
                    </button>
                    {loginError && <p className="text-sm text-red-400">{loginError}</p>}
                  </div>
                ) : (
                  <ChatComposer
                    protocol="meshcore"
                    viewKey={roomViewKey}
                    isConnected={isConnected}
                    connectionType={connectionType}
                    allowOutbox={false}
                    variant="room"
                    placeholder={t('roomsPanel.postPlaceholder')}
                    sendButtonLabel={t('roomsPanel.postButton')}
                    sendingButtonLabel={t('roomsPanel.posting')}
                    payloadLimit={MESHCORE_PAYLOAD_LIMIT - 4}
                    mentionNodes={mentionNodes}
                    onSendChunk={handleSendChunk}
                  />
                )}
              </div>

              {manageOpen && (
                <div className="border-t border-gray-700 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium text-gray-200">
                      {t('roomsPanel.manageHeading')}
                    </h4>
                    <button
                      type="button"
                      onClick={() => {
                        setManageOpen(false);
                      }}
                      className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                      aria-label={t('roomsPanel.closeManage')}
                    >
                      {t('roomsPanel.closeManage')}
                    </button>
                  </div>
                  <div className="mb-2 flex gap-2">
                    <input
                      type="text"
                      value={cliInput}
                      onChange={(e) => {
                        setCliInput(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCliSend();
                      }}
                      placeholder={t('roomsPanel.cliPlaceholder')}
                      disabled={!isConnected || cliPending}
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-200"
                      aria-label={t('roomsPanel.cliPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void handleCliSend();
                      }}
                      disabled={!isConnected || cliPending || !cliInput.trim()}
                      className="rounded border border-cyan-700 bg-cyan-900/60 px-3 py-1 text-xs text-cyan-300 disabled:opacity-40"
                    >
                      {t('roomsPanel.cliSend')}
                    </button>
                    {onClearCliHistory && (
                      <button
                        type="button"
                        onClick={() => {
                          onClearCliHistory(selectedRoomId);
                        }}
                        className="text-xs text-gray-500 underline"
                      >
                        {t('roomsPanel.clearCli')}
                      </button>
                    )}
                  </div>
                  {cliError && <p className="mb-2 text-xs text-red-400">{cliError}</p>}
                  <form className="mb-2 flex flex-wrap items-end gap-2" onSubmit={handleAclSubmit}>
                    <label className="min-w-[12rem] flex-1 space-y-1">
                      <span className="text-xs text-gray-400">
                        {t('roomsPanel.aclPubkeyLabel')}
                      </span>
                      <input
                        type="text"
                        value={aclPubkey}
                        onChange={(e) => {
                          setAclPubkey(e.target.value);
                        }}
                        placeholder="0123456789abcdef…"
                        className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-200"
                        aria-label={t('roomsPanel.aclPubkeyLabel')}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-gray-400">{t('roomsPanel.aclLevelLabel')}</span>
                      <select
                        value={aclLevel}
                        onChange={(e) => {
                          setAclLevel(Number.parseInt(e.target.value, 10));
                        }}
                        className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-200"
                        aria-label={t('roomsPanel.aclLevelLabel')}
                      >
                        <option value={0}>{t('roomsPanel.aclLevelRemove')}</option>
                        <option value={1}>{t('roomsPanel.aclLevelGuest')}</option>
                        <option value={2}>{t('roomsPanel.aclLevelReadWrite')}</option>
                        <option value={3}>{t('roomsPanel.aclLevelAdmin')}</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={!isConnected || !/^[0-9a-f]{64}$/i.test(aclPubkey.trim())}
                      className="rounded border border-gray-600 bg-gray-700 px-3 py-1 text-xs text-gray-200 disabled:opacity-40"
                    >
                      {t('roomsPanel.aclApply')}
                    </button>
                  </form>
                  <div className="max-h-32 overflow-y-auto rounded border border-gray-700 bg-gray-950/50 p-2 font-mono text-xs">
                    {cliHistory.length === 0 ? (
                      <p className="text-gray-500 italic">{t('roomsPanel.cliEmpty')}</p>
                    ) : (
                      cliHistory.map((entry, idx) => (
                        <div
                          key={`${entry.timestamp}:${idx}`}
                          className={entry.type === 'sent' ? 'text-cyan-300' : 'text-gray-300'}
                        >
                          {entry.type === 'sent' ? '> ' : '< '}
                          {entry.text}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
