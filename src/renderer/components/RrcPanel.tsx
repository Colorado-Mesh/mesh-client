import {
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  LogIn,
  LogOut,
  RefreshCw,
  Star,
  Users,
} from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { loadMutedViews, saveMutedViews } from '@/renderer/lib/chatPanelProtocolStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  loadRrcRecentRooms,
  pushRrcRecentRoom,
  RRC_SUGGESTED_ROOMS,
} from '@/renderer/lib/rrcRecentRooms';
import {
  normalizeRrcRoomName,
  parseRrcSlashInput,
  RRC_HELP_I18N_KEYS,
} from '@/renderer/lib/rrcSlashCommands';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { RRC_HUB_STREAM_ROOM, useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcHubInfo } from '@/shared/rrc-types';

const COLLAPSED_KEY = 'mesh-client:rrcHubListCollapsed';
const ROOM_LIST_COLLAPSED_KEY = 'mesh-client:rrc:roomListCollapsed';
const NICK_KEY = 'mesh-client:rrcNickname';

function formatHash(hash: string): string {
  return hash.slice(0, 8);
}

function roomCollapsedLabel(name: string): string {
  const cleaned = name.replace(/^#/, '').trim();
  if (!cleaned) return '??';
  return cleaned.slice(0, 2).toUpperCase();
}

function hubMatchesSearch(hub: RrcHubInfo, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    hub.destination_hash.includes(needle) ||
    (hub.display_name?.toLowerCase().includes(needle) ?? false)
  );
}

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return false;
  }
}

export interface RrcPanelProps {
  isActive: boolean;
}

export default function RrcPanel({ isActive }: RrcPanelProps) {
  const { t } = useTranslation();
  const hubs = useRrcHubStore((s) => s.hubs);
  const refreshFromSidecar = useRrcHubStore((s) => s.refreshFromSidecar);
  const toggleFavorite = useRrcHubStore((s) => s.toggleFavorite);
  const upsertManual = useRrcHubStore((s) => s.upsertManual);

  const status = useRrcSessionStore((s) => s.status);
  const hubDestHash = useRrcSessionStore((s) => s.hubDestHash);
  const hubName = useRrcSessionStore((s) => s.hubName);
  const nickname = useRrcSessionStore((s) => s.nickname);
  const rooms = useRrcSessionStore((s) => s.rooms);
  const messages = useRrcSessionStore((s) => s.messages);
  const activeRoom = useRrcSessionStore((s) => s.activeRoom);
  const lastError = useRrcSessionStore((s) => s.lastError);
  const unreadByRoom = useRrcSessionStore((s) => s.unreadByRoom);
  const showTimestamps = useRrcSessionStore((s) => s.showTimestamps);
  const setNickname = useRrcSessionStore((s) => s.setNickname);
  const setActiveRoom = useRrcSessionStore((s) => s.setActiveRoom);
  const setShowTimestamps = useRrcSessionStore((s) => s.setShowTimestamps);
  const clearUnread = useRrcSessionStore((s) => s.clearUnread);
  const clearActiveRoomMessages = useRrcSessionStore((s) => s.clearActiveRoomMessages);
  const addMessage = useRrcSessionStore((s) => s.addMessage);
  const messagesForActiveRoom = useRrcSessionStore((s) => s.messagesForActiveRoom);

  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(COLLAPSED_KEY));
  const [roomListCollapsed, setRoomListCollapsed] = useState(() =>
    readCollapsed(ROOM_LIST_COLLAPSED_KEY),
  );
  const [hubSearch, setHubSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [joinRoomName, setJoinRoomName] = useState('#lobby');
  const [joinRoomKey, setJoinRoomKey] = useState('');
  /** Bumps when we push a recent room so the memo reloads from localStorage. */
  const [recentRoomsEpoch, setRecentRoomsEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [mutedViews, setMutedViews] = useState(() => loadMutedViews('reticulum'));
  const [draft, setDraft] = useState('');

  useEffect(() => {
    try {
      const nick = localStorage.getItem(NICK_KEY);
      if (nick) setNickname(nick);
    } catch {
      // catch-no-log-ok localStorage may be unavailable
    }
  }, [setNickname]);

  const recentRooms = useMemo(() => {
    if (!hubDestHash) return [];
    void recentRoomsEpoch;
    return loadRrcRecentRooms(hubDestHash);
  }, [hubDestHash, recentRoomsEpoch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const running = await isReticulumSidecarRunning();
      if (!cancelled) {
        setSidecarRunning(running);
        if (running) void refreshFromSidecar();
      }
    })();
    const unsub = window.electronAPI.reticulum.onStatus((s) => {
      setSidecarRunning(s.running);
      if (s.running) void refreshFromSidecar();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [refreshFromSidecar]);

  useEffect(() => {
    if (isActive && activeRoom) clearUnread(activeRoom);
  }, [isActive, activeRoom, clearUnread, messages]);

  const hubList = useMemo(() => {
    const all = [...hubs.values()].filter((h) => hubMatchesSearch(h, hubSearch));
    const recommended = all.filter((h) => h.recommended);
    const favourites = all.filter((h) => h.favorited && !h.recommended);
    const discovered = all.filter(
      (h) => !h.recommended && !h.favorited && (h.source === 'discovered' || h.hops != null),
    );
    const manual = all.filter(
      (h) => !h.recommended && !h.favorited && h.source === 'manual' && h.hops == null,
    );
    return { recommended, favourites, discovered, manual };
  }, [hubs, hubSearch]);

  const roomList = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    return [...rooms.values()].filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rooms, roomSearch]);

  const joinedKeys = useMemo(() => new Set([...rooms.keys()].map((k) => k.toLowerCase())), [rooms]);

  const suggestedRooms = useMemo(
    () => RRC_SUGGESTED_ROOMS.filter((r) => !joinedKeys.has(r.toLowerCase())),
    [joinedKeys],
  );

  const recentNotJoined = useMemo(
    () =>
      recentRooms.filter(
        (r) =>
          !joinedKeys.has(r.toLowerCase()) &&
          !RRC_SUGGESTED_ROOMS.some((s) => s.toLowerCase() === r.toLowerCase()),
      ),
    [recentRooms, joinedKeys],
  );

  const activeMessages = messagesForActiveRoom();
  const activeRoomInfo = activeRoom ? rooms.get(activeRoom) : undefined;
  const muteKey = hubDestHash && activeRoom ? `rrc:${hubDestHash}:${activeRoom}` : null;
  const isMuted = muteKey ? mutedViews.has(muteKey) : false;
  const connected = status === 'active' || status === 'awaiting_welcome';

  const persistCollapsed = (key: string, next: boolean) => {
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // catch-no-log-ok localStorage may be unavailable
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      persistCollapsed(COLLAPSED_KEY, next);
      return next;
    });
  };

  const toggleRoomListCollapsed = () => {
    setRoomListCollapsed((c) => {
      const next = !c;
      persistCollapsed(ROOM_LIST_COLLAPSED_KEY, next);
      return next;
    });
  };

  const handleConnect = useCallback(
    async (hash: string) => {
      setBusy(true);
      try {
        const res = await window.electronAPI.reticulum.rrc.connect({
          dest_hash: hash,
          nickname,
        });
        if (!res.ok) {
          useRrcSessionStore.getState().setError(res.error ?? t('rrc.connectFailed'));
        }
      } catch (e) {
        // catch-no-log-ok error surfaced via setError
        useRrcSessionStore.getState().setError(errLikeToLogString(e));
      } finally {
        setBusy(false);
      }
    },
    [nickname, t],
  );

  const handleDisconnect = useCallback(async () => {
    setBusy(true);
    try {
      await window.electronAPI.reticulum.rrc.disconnect();
      useRrcSessionStore.getState().clearSession();
    } catch (e) {
      console.warn('[RrcPanel] disconnect ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleManualConnect = useCallback(async () => {
    const hub = await upsertManual(manualHash);
    if (!hub) {
      useRrcSessionStore.getState().setError(t('rrc.invalidHubHash'));
      return;
    }
    setManualHash('');
    await handleConnect(hub.destination_hash);
  }, [manualHash, upsertManual, handleConnect, t]);

  const joinRoom = useCallback(
    async (roomRaw: string, key?: string) => {
      const room = roomRaw.trim();
      if (!room) return;
      setBusy(true);
      try {
        const res = await window.electronAPI.reticulum.rrc.join({
          room,
          key: key?.trim() || undefined,
        });
        if (!res.ok) {
          useRrcSessionStore.getState().setError(res.error ?? t('rrc.joinFailed'));
        } else {
          setActiveRoom(room);
          if (hubDestHash) {
            pushRrcRecentRoom(hubDestHash, normalizeRrcRoomName(room));
            setRecentRoomsEpoch((n) => n + 1);
          }
        }
      } catch (e) {
        // catch-no-log-ok error surfaced via setError
        useRrcSessionStore.getState().setError(errLikeToLogString(e));
      } finally {
        setBusy(false);
      }
    },
    [hubDestHash, setActiveRoom, t],
  );

  const handleJoin = useCallback(async () => {
    await joinRoom(joinRoomName, joinRoomKey);
  }, [joinRoom, joinRoomName, joinRoomKey]);

  const handlePart = useCallback(
    async (room?: string) => {
      const target = (room ?? activeRoom)?.trim();
      if (!target) return;
      setBusy(true);
      try {
        await window.electronAPI.reticulum.rrc.part({ room: target });
      } catch (e) {
        console.warn('[RrcPanel] part ' + errLikeToLogString(e));
      } finally {
        setBusy(false);
      }
    },
    [activeRoom],
  );

  const appendSystemLines = useCallback(
    (lines: string[]) => {
      const room = activeRoom ?? RRC_HUB_STREAM_ROOM;
      if (!activeRoom) setActiveRoom(RRC_HUB_STREAM_ROOM);
      for (const line of lines) {
        addMessage({
          id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          room,
          kind: 'system',
          body: line,
          timestamp: Date.now(),
        });
      }
    },
    [activeRoom, addMessage, setActiveRoom],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const parsed = parseRrcSlashInput(text);
      if (!parsed) return;

      if (parsed.kind === 'local') {
        if (parsed.command === 'help') {
          appendSystemLines(RRC_HELP_I18N_KEYS.map((k) => t(k)));
          setDraft('');
          return;
        }
        if (parsed.command === 'usage') {
          useRrcSessionStore.getState().setError(t(parsed.messageKey));
          return;
        }
        if (parsed.command === 'nick') {
          setNickname(parsed.nickname);
          try {
            localStorage.setItem(NICK_KEY, parsed.nickname);
          } catch {
            // catch-no-log-ok
          }
          appendSystemLines([t('rrc.slash.nickChanged', { name: parsed.nickname })]);
          setDraft('');
          return;
        }
        if (parsed.command === 'join') {
          await joinRoom(parsed.room, parsed.key);
          setDraft('');
          return;
        }
        if (parsed.command === 'part') {
          await handlePart(parsed.room);
          setDraft('');
          return;
        }
        if (parsed.command === 'me') {
          if (status !== 'active') {
            useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
            return;
          }
          if (!activeRoom) {
            useRrcSessionStore.getState().setError(t('rrc.joinRoomPrompt'));
            return;
          }
          const res = await window.electronAPI.reticulum.rrc.send({
            room: activeRoom,
            body: parsed.action,
            type: 'action',
          });
          if (!res.ok) {
            useRrcSessionStore.getState().setError(res.error ?? t('rrc.sendFailed'));
            return;
          }
          setDraft('');
          return;
        }
        if (parsed.command === 'clear') {
          clearActiveRoomMessages();
          setDraft('');
          return;
        }
        if (parsed.command === 'quit') {
          await handleDisconnect();
          setDraft('');
          return;
        }
      }

      if (parsed.kind === 'hub') {
        if (status !== 'active') {
          useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
          return;
        }
        const res = await window.electronAPI.reticulum.rrc.send({
          room: activeRoom ?? undefined,
          body: parsed.body,
          type: 'msg',
        });
        if (!res.ok) {
          useRrcSessionStore.getState().setError(res.error ?? t('rrc.sendFailed'));
          return;
        }
        appendSystemLines([t('rrc.slash.commandSent', { cmd: parsed.body })]);
        setDraft('');
        return;
      }

      // Normal chat — wait for hub echo (no optimistic local append).
      if (!activeRoom) {
        useRrcSessionStore.getState().setError(t('rrc.joinRoomPrompt'));
        return;
      }
      if (status !== 'active') {
        useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
        return;
      }
      const res = await window.electronAPI.reticulum.rrc.send({
        room: activeRoom,
        body: parsed.body,
        type: 'msg',
      });
      if (!res.ok) {
        useRrcSessionStore.getState().setError(res.error ?? t('rrc.sendFailed'));
        return;
      }
      setDraft('');
    },
    [
      activeRoom,
      appendSystemLines,
      clearActiveRoomMessages,
      handleDisconnect,
      handlePart,
      joinRoom,
      setNickname,
      status,
      t,
    ],
  );

  const toggleMute = () => {
    if (!muteKey) return;
    const next = new Set(mutedViews);
    if (next.has(muteKey)) next.delete(muteKey);
    else next.add(muteKey);
    setMutedViews(next);
    saveMutedViews('reticulum', next);
  };

  const renderHubSection = (title: string, rows: RrcHubInfo[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="px-2 py-1 text-[10px] tracking-wide text-gray-500 uppercase">{title}</div>
        <ul className="space-y-0.5">
          {rows.map((hub) => {
            const selected = hubDestHash?.toLowerCase() === hub.destination_hash.toLowerCase();
            const announceOnly = hub.name_source === 'announce' && !hub.recommended;
            const label = announceOnly
              ? formatHash(hub.destination_hash)
              : (hub.display_name ?? formatHash(hub.destination_hash));
            const secondary = announceOnly
              ? (hub.display_name ?? null)
              : hub.display_name
                ? formatHash(hub.destination_hash)
                : null;
            return (
              <li key={hub.destination_hash}>
                <div
                  className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm ${
                    selected
                      ? 'border-bright-green bg-sidebar-active-bg border-l-2'
                      : 'hover:bg-slate-700/60'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-label={t('rrc.selectHub', { name: label })}
                    onClick={() => void handleConnect(hub.destination_hash)}
                    disabled={busy || !sidecarRunning}
                  >
                    <div className="truncate font-medium text-gray-100">{label}</div>
                    <div className="truncate text-xs text-gray-500">
                      {secondary ?? formatHash(hub.destination_hash)}
                      {hub.hops != null ? ` · ${t('rrc.hopsAway', { count: hub.hops })}` : ''}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 p-1 text-yellow-400"
                    aria-label={hub.favorited ? t('rrc.unfavoriteHub') : t('rrc.favoriteHub')}
                    onClick={() => void toggleFavorite(hub.destination_hash, !hub.favorited)}
                  >
                    <Star size={14} fill={hub.favorited ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderRoomButton = (name: string, opts?: { unread?: number; joined?: boolean }) => {
    const key = name.trim().toLowerCase();
    const selected = activeRoom === key;
    const unread = opts?.unread ?? 0;
    if (roomListCollapsed) {
      return (
        <li key={key}>
          <button
            type="button"
            className={`relative flex w-full flex-col items-center gap-0.5 rounded px-1 py-1.5 ${
              selected
                ? 'border-bright-green bg-sidebar-active-bg border-l-2'
                : 'hover:bg-slate-700/60'
            }`}
            title={name}
            aria-label={t('rrc.selectRoom', { name })}
            onClick={() => {
              if (opts?.joined === false) void joinRoom(name);
              else setActiveRoom(name);
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-800/80 text-[10px] font-semibold">
              {roomCollapsedLabel(name)}
            </span>
            {unread > 0 && !selected && (
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-600" />
            )}
          </button>
        </li>
      );
    }
    return (
      <li key={key}>
        <button
          type="button"
          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
            selected ? 'bg-sidebar-active-bg text-white' : 'hover:bg-slate-700/60'
          }`}
          aria-label={t('rrc.selectRoom', { name })}
          onClick={() => {
            if (opts?.joined === false) void joinRoom(name);
            else setActiveRoom(name);
          }}
        >
          <span className="truncate">{name}</span>
          {unread > 0 && !selected && (
            <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="bg-primary-dark flex h-full w-full min-w-0 text-gray-100">
      <aside
        className={`bg-secondary-dark flex shrink-0 flex-col border-r border-slate-700 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="flex items-center justify-between gap-1 border-b border-slate-700 p-2">
          {!collapsed && (
            <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
              {t('rrc.hubsTitle')}
            </span>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 hover:bg-slate-700"
              aria-label={t('rrc.refreshHubs')}
              disabled={!sidecarRunning}
              onClick={() => void refreshFromSidecar()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="rounded p-1 hover:bg-slate-700"
              aria-label={collapsed ? t('rrc.expandSidebar') : t('rrc.collapseSidebar')}
              onClick={toggleCollapsed}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {!sidecarRunning && (
              <div className="rounded border border-amber-600/50 bg-amber-900/30 p-2 text-xs text-amber-200">
                {t('connectionPanel.reticulumIdentity.startStackFirst')}
              </div>
            )}
            <input
              type="search"
              value={hubSearch}
              onChange={(e) => {
                setHubSearch(e.target.value);
              }}
              placeholder={t('rrc.searchHubs')}
              aria-label={t('rrc.searchHubs')}
              className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
            />
            <label className="block text-xs text-gray-400">
              {t('rrc.nickname')}
              <input
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  try {
                    localStorage.setItem(NICK_KEY, e.target.value);
                  } catch {
                    // catch-no-log-ok
                  }
                }}
                aria-label={t('rrc.nickname')}
                className="mt-0.5 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-gray-100"
              />
            </label>
            {renderHubSection(t('rrc.hubs.recommended'), hubList.recommended)}
            {renderHubSection(t('rrc.hubs.favourites'), hubList.favourites)}
            {renderHubSection(t('rrc.hubs.discovered'), hubList.discovered)}
            {renderHubSection(t('rrc.hubs.manual'), hubList.manual)}
            {hubList.discovered.length === 0 && (
              <p className="px-2 text-xs text-gray-500">{t('rrc.noDiscoveredHubs')}</p>
            )}
            <div className="mt-auto space-y-1 border-t border-slate-700 pt-2">
              <input
                type="text"
                value={manualHash}
                onChange={(e) => {
                  setManualHash(e.target.value);
                }}
                placeholder={t('rrc.manualHashPlaceholder')}
                aria-label={t('rrc.manualHashPlaceholder')}
                className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                className="bg-readable-green w-full rounded px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                aria-label={t('rrc.connectManual')}
                disabled={busy || !sidecarRunning || !manualHash.trim()}
                onClick={() => void handleManualConnect()}
              >
                {t('rrc.connectManual')}
              </button>
            </div>
          </div>
        )}
      </aside>

      {connected && (
        <aside
          className={`bg-secondary-dark/80 flex shrink-0 flex-col border-r border-slate-700 ${
            roomListCollapsed ? 'w-16' : 'w-48'
          }`}
        >
          <div className="flex items-center justify-between gap-1 border-b border-slate-700 p-2">
            {!roomListCollapsed && (
              <span className="text-xs font-semibold tracking-wide text-gray-400 uppercase">
                {t('rrc.rooms')}
              </span>
            )}
            <button
              type="button"
              className="rounded p-1 hover:bg-slate-700"
              aria-label={roomListCollapsed ? t('rrc.expandRooms') : t('rrc.collapseRooms')}
              aria-expanded={!roomListCollapsed}
              onClick={toggleRoomListCollapsed}
            >
              {roomListCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>
          {!roomListCollapsed && (
            <div className="space-y-2 p-2">
              <input
                type="search"
                value={roomSearch}
                onChange={(e) => {
                  setRoomSearch(e.target.value);
                }}
                placeholder={t('rrc.searchRooms')}
                aria-label={t('rrc.searchRooms')}
                className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
              />
              <div className="flex gap-1">
                <input
                  type="text"
                  value={joinRoomName}
                  onChange={(e) => {
                    setJoinRoomName(e.target.value);
                  }}
                  aria-label={t('rrc.joinRoom')}
                  className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  className="rounded bg-slate-600 px-2 py-1 text-xs"
                  aria-label={t('rrc.join')}
                  disabled={busy}
                  onClick={() => void handleJoin()}
                >
                  <LogIn size={14} />
                </button>
              </div>
              <input
                type="password"
                value={joinRoomKey}
                onChange={(e) => {
                  setJoinRoomKey(e.target.value);
                }}
                placeholder={t('rrc.roomKeyOptional')}
                aria-label={t('rrc.roomKeyOptional')}
                className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
              />
              <p className="text-[10px] leading-snug text-gray-500">{t('rrc.listHint')}</p>
            </div>
          )}
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {!roomListCollapsed && roomList.length > 0 && (
              <li className="px-2 py-1 text-[10px] tracking-wide text-gray-500 uppercase">
                {t('rrc.joinedRooms')}
              </li>
            )}
            {roomList.map((room) =>
              renderRoomButton(room.name, {
                unread: unreadByRoom.get(room.name.trim().toLowerCase()) ?? 0,
                joined: true,
              }),
            )}
            {!roomListCollapsed && suggestedRooms.length > 0 && (
              <li className="mt-2 px-2 py-1 text-[10px] tracking-wide text-gray-500 uppercase">
                {t('rrc.suggestedRooms')}
              </li>
            )}
            {suggestedRooms.map((name) => renderRoomButton(name, { joined: false }))}
            {!roomListCollapsed && recentNotJoined.length > 0 && (
              <li className="mt-2 px-2 py-1 text-[10px] tracking-wide text-gray-500 uppercase">
                {t('rrc.recentRooms')}
              </li>
            )}
            {recentNotJoined.map((name) => renderRoomButton(name, { joined: false }))}
            {roomList.length === 0 && !roomListCollapsed && (
              <li className="px-2 text-xs text-gray-500">{t('rrc.noRoomsJoined')}</li>
            )}
          </ul>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {hubName ?? hubDestHash ?? t('rrc.selectHubPrompt')}
            </div>
            <div className="text-xs text-gray-400">
              {t(`rrc.status.${status}`)}
              {activeRoom ? ` · ${activeRoom}` : ''}
            </div>
          </div>
          {connected && (
            <>
              <button
                type="button"
                className={`rounded p-1.5 hover:bg-slate-700 ${showTimestamps ? 'text-bright-green' : ''}`}
                aria-label={t('rrc.toggleTimestamps')}
                onClick={() => {
                  setShowTimestamps(!showTimestamps);
                }}
              >
                <Clock size={16} />
              </button>
              <button
                type="button"
                className={`rounded p-1.5 hover:bg-slate-700 ${isMuted ? 'text-amber-400' : ''}`}
                aria-label={isMuted ? t('rrc.unmuteRoom') : t('rrc.muteRoom')}
                disabled={!muteKey}
                onClick={toggleMute}
              >
                {isMuted ? <BellOff size={16} /> : <Bell size={16} />}
              </button>
              <button
                type="button"
                className="rounded p-1.5 hover:bg-slate-700"
                aria-label={t('rrc.toggleMembers')}
                onClick={() => {
                  setShowMembers((v) => !v);
                }}
              >
                <Users size={16} />
              </button>
              {activeRoom && activeRoom !== RRC_HUB_STREAM_ROOM && (
                <button
                  type="button"
                  className="rounded p-1.5 hover:bg-slate-700"
                  aria-label={t('rrc.leaveRoom')}
                  disabled={busy}
                  onClick={() => void handlePart()}
                >
                  <LogOut size={16} />
                </button>
              )}
              <button
                type="button"
                className="rounded bg-slate-600 px-2 py-1 text-xs"
                aria-label={t('rrc.disconnect')}
                disabled={busy}
                onClick={() => void handleDisconnect()}
              >
                {t('rrc.disconnect')}
              </button>
            </>
          )}
        </header>
        {lastError && (
          <div className="border-b border-red-800/50 bg-red-900/30 px-3 py-1.5 text-xs text-red-200">
            {lastError}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {!connected && (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-400">
                {t('rrc.selectHubPrompt')}
              </div>
            )}
            {connected && (
              <>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {!activeRoom && (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-gray-400">
                      <p>{t('rrc.joinRoomPrompt')}</p>
                      <p className="max-w-md text-xs text-gray-500">{t('rrc.joinRoomHelp')}</p>
                    </div>
                  )}
                  {activeRoom &&
                    activeMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded px-2 py-1 text-sm ${
                          msg.kind === 'notice' || msg.kind === 'system'
                            ? 'text-amber-200'
                            : msg.kind === 'action'
                              ? 'text-cyan-200 italic'
                              : msg.kind === 'error'
                                ? 'text-red-300'
                                : 'text-gray-100'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            {msg.kind !== 'system' && msg.kind !== 'error' && (
                              <span className="font-medium text-gray-300">
                                {msg.kind === 'action'
                                  ? `* ${msg.nickname || formatHash(msg.sender_hash ?? '')}`
                                  : msg.nickname || formatHash(msg.sender_hash ?? '')}
                              </span>
                            )}
                            {showTimestamps && (
                              <span className="ml-2 text-[10px] text-gray-500">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                              </span>
                            )}
                            <div className="break-words whitespace-pre-wrap">{msg.body}</div>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 p-1 text-gray-500 hover:text-gray-200"
                            aria-label={t('rrc.copyMessage')}
                            onClick={() => void navigator.clipboard.writeText(msg.body)}
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
                <div className="flex gap-2 border-t border-slate-700 p-2">
                  <textarea
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend(draft);
                      }
                    }}
                    disabled={status !== 'active' || isMuted}
                    placeholder={t('rrc.messagePlaceholder')}
                    aria-label={t('rrc.messagePlaceholder')}
                    rows={2}
                    className="min-w-0 flex-1 resize-none rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-gray-100 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    className="bg-readable-green self-end rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    aria-label={t('rrc.send')}
                    disabled={status !== 'active' || isMuted || !draft.trim()}
                    onClick={() => void handleSend(draft)}
                  >
                    {t('rrc.send')}
                  </button>
                </div>
              </>
            )}
          </div>
          {showMembers && activeRoomInfo && (
            <aside className="w-44 shrink-0 overflow-y-auto border-l border-slate-700 p-2">
              <div className="mb-2 text-xs font-semibold text-gray-400 uppercase">
                {t('rrc.members')}
              </div>
              <ul className="space-y-1 text-xs">
                {(activeRoomInfo.members ?? []).map((m) => (
                  <li key={m.identity_hash} className="truncate text-gray-300">
                    {m.nickname || formatHash(m.identity_hash)}
                  </li>
                ))}
                {(activeRoomInfo.members ?? []).length === 0 && (
                  <li className="text-gray-500">{t('rrc.noMembers')}</li>
                )}
              </ul>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
