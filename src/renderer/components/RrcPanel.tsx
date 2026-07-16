import { Bell, BellOff, Clock, LogOut, X } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RrcChatView } from '@/renderer/components/rrc/RrcChatView';
import { RrcHubBrowser } from '@/renderer/components/rrc/RrcHubBrowser';
import { RrcNickList } from '@/renderer/components/rrc/RrcNickList';
import { RrcRoomSidebar } from '@/renderer/components/rrc/RrcRoomSidebar';
import { RrcTopicBar } from '@/renderer/components/rrc/RrcTopicBar';
import { loadMutedViews, saveMutedViews } from '@/renderer/lib/chatPanelProtocolStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  loadRrcRecentRooms,
  pushRrcRecentRoom,
  RRC_SUGGESTED_ROOMS,
} from '@/renderer/lib/rrcRecentRooms';
import {
  loadRrcAutoJoinRooms,
  loadRrcRoomFavourites,
  toggleRrcAutoJoinRoom,
  toggleRrcRoomFavourite,
} from '@/renderer/lib/rrcRoomPrefs';
import {
  normalizeRrcRoomName,
  parseRrcSlashInput,
  resolveRrcMsgTarget,
  RRC_HELP_I18N_KEYS,
} from '@/renderer/lib/rrcSlashCommands';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import {
  RRC_HUB_STREAM_ROOM,
  RRC_WHISPERS_ROOM,
  useRrcSessionStore,
} from '@/renderer/stores/rrcSessionStore';
import type { RrcHubInfo, RrcRoomMember } from '@/shared/rrc-types';

const COLLAPSED_KEY = 'mesh-client:rrcHubListCollapsed';
const ROOM_LIST_COLLAPSED_KEY = 'mesh-client:rrc:roomListCollapsed';
const NICK_KEY = 'mesh-client:rrcNickname';

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

function persistCollapsed(key: string, next: boolean) {
  try {
    localStorage.setItem(key, next ? '1' : '0');
  } catch {
    // catch-no-log-ok localStorage may be unavailable
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
  const listedRooms = useRrcSessionStore((s) => s.listedRooms);
  const messages = useRrcSessionStore((s) => s.messages);
  const activeRoom = useRrcSessionStore((s) => s.activeRoom);
  const lastError = useRrcSessionStore((s) => s.lastError);
  const moderationBanner = useRrcSessionStore((s) => s.moderationBanner);
  const unreadByRoom = useRrcSessionStore((s) => s.unreadByRoom);
  const showTimestamps = useRrcSessionStore((s) => s.showTimestamps);
  const capabilities = useRrcSessionStore((s) => s.capabilities);
  const setNickname = useRrcSessionStore((s) => s.setNickname);
  const setActiveRoom = useRrcSessionStore((s) => s.setActiveRoom);
  const setShowTimestamps = useRrcSessionStore((s) => s.setShowTimestamps);
  const clearUnread = useRrcSessionStore((s) => s.clearUnread);
  const clearActiveRoomMessages = useRrcSessionStore((s) => s.clearActiveRoomMessages);
  const addMessage = useRrcSessionStore((s) => s.addMessage);
  const messagesForActiveRoom = useRrcSessionStore((s) => s.messagesForActiveRoom);
  const markPartIntent = useRrcSessionStore((s) => s.markPartIntent);
  const setDisconnectIntent = useRrcSessionStore((s) => s.setDisconnectIntent);
  const setModerationBanner = useRrcSessionStore((s) => s.setModerationBanner);

  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(COLLAPSED_KEY));
  const [roomListCollapsed, setRoomListCollapsed] = useState(() =>
    readCollapsed(ROOM_LIST_COLLAPSED_KEY),
  );
  const [hubTab, setHubTab] = useState<'recommended' | 'discovered'>('recommended');
  const [hubSearch, setHubSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [joinRoomName, setJoinRoomName] = useState('#lobby');
  const [joinRoomKey, setJoinRoomKey] = useState('');
  const [recentRoomsEpoch, setRecentRoomsEpoch] = useState(0);
  const [prefsEpoch, setPrefsEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [mutedViews, setMutedViews] = useState(() => loadMutedViews('reticulum'));
  const [draft, setDraft] = useState('');
  const listSentForHubRef = useRef<string | null>(null);
  const autoJoinDoneRef = useRef<string | null>(null);

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

  const roomFavourites = useMemo(() => {
    if (!hubDestHash) return [];
    void prefsEpoch;
    return loadRrcRoomFavourites(hubDestHash);
  }, [hubDestHash, prefsEpoch]);

  const autoJoinRooms = useMemo(() => {
    if (!hubDestHash) return [];
    void prefsEpoch;
    return loadRrcAutoJoinRooms(hubDestHash);
  }, [hubDestHash, prefsEpoch]);

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

  const sendHubCommand = useCallback(
    async (body: string) => {
      if (status !== 'active') return;
      await window.electronAPI.reticulum.rrc.send({
        room: activeRoom && !activeRoom.startsWith('[') ? activeRoom : undefined,
        body,
        type: 'msg',
      });
    },
    [activeRoom, status],
  );

  // Auto /list on connect + auto-join favourites.
  useEffect(() => {
    if (status !== 'active' || !hubDestHash) {
      if (status === 'disconnected') {
        listSentForHubRef.current = null;
        autoJoinDoneRef.current = null;
      }
      return;
    }
    if (listSentForHubRef.current !== hubDestHash) {
      listSentForHubRef.current = hubDestHash;
      void sendHubCommand('/list').catch((e: unknown) => {
        console.debug('[RrcPanel] auto /list ' + errLikeToLogString(e));
      });
    }
    if (autoJoinDoneRef.current !== hubDestHash) {
      autoJoinDoneRef.current = hubDestHash;
      const roomsToJoin = loadRrcAutoJoinRooms(hubDestHash);
      for (const room of roomsToJoin) {
        void window.electronAPI.reticulum.rrc.join({ room }).catch((e: unknown) => {
          console.debug('[RrcPanel] auto-join ' + errLikeToLogString(e));
        });
      }
    }
  }, [status, hubDestHash, sendHubCommand]);

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

  const roomList = useMemo(() => [...rooms.values()], [rooms]);

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
          !RRC_SUGGESTED_ROOMS.some((s) => s.toLowerCase() === r.toLowerCase()) &&
          !listedRooms.some((l) => l.name.toLowerCase() === r.toLowerCase()),
      ),
    [recentRooms, joinedKeys, listedRooms],
  );

  const activeMessages = messagesForActiveRoom();
  const activeRoomInfo = activeRoom ? rooms.get(activeRoom) : undefined;
  const muteKey = hubDestHash && activeRoom ? `rrc:${hubDestHash}:${activeRoom}` : null;
  const isMuted = muteKey ? mutedViews.has(muteKey) : false;
  const connected =
    status === 'active' || status === 'awaiting_welcome' || status === 'reconnecting';
  const showNicklist =
    Boolean(activeRoom) && activeRoom !== RRC_HUB_STREAM_ROOM && !activeRoom?.startsWith('[');

  const handleConnect = useCallback(
    async (hash: string) => {
      setBusy(true);
      setDisconnectIntent(false);
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
    [nickname, setDisconnectIntent, t],
  );

  const handleDisconnect = useCallback(async () => {
    setBusy(true);
    setDisconnectIntent(true);
    try {
      await window.electronAPI.reticulum.rrc.disconnect();
      useRrcSessionStore.getState().clearSession();
    } catch (e) {
      console.warn('[RrcPanel] disconnect ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  }, [setDisconnectIntent]);

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

  const handlePart = useCallback(
    async (room?: string) => {
      const target = (room ?? activeRoom)?.trim();
      if (!target || target.startsWith('[')) return;
      markPartIntent(target);
      setBusy(true);
      try {
        await window.electronAPI.reticulum.rrc.part({ room: target });
      } catch (e) {
        console.warn('[RrcPanel] part ' + errLikeToLogString(e));
        useRrcSessionStore.getState().clearPartIntent(target);
      } finally {
        setBusy(false);
      }
    },
    [activeRoom, markPartIntent],
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
          if (!activeRoom || activeRoom.startsWith('[')) {
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
        if (parsed.command === 'msg') {
          if (status !== 'active') {
            useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
            return;
          }
          if (!capabilities.direct_notice) {
            useRrcSessionStore.getState().setError(t('rrc.directNoticeUnsupported'));
            return;
          }
          const members = activeRoomInfo?.members ?? [];
          const allMembers = [...members, ...[...rooms.values()].flatMap((r) => r.members ?? [])];
          const resolved = resolveRrcMsgTarget(parsed.target, allMembers);
          if (resolved?.identity_hash.length !== 32) {
            useRrcSessionStore.getState().setError(t('rrc.slash.msgTargetNotFound'));
            return;
          }
          const res = await window.electronAPI.reticulum.rrc.send({
            body: parsed.text,
            type: 'notice',
            dst_hash: resolved.identity_hash,
          });
          if (!res.ok) {
            useRrcSessionStore.getState().setError(res.error ?? t('rrc.sendFailed'));
            return;
          }
          const label = resolved.nickname || resolved.identity_hash.slice(0, 8);
          if (activeRoom !== RRC_WHISPERS_ROOM) setActiveRoom(RRC_WHISPERS_ROOM);
          addMessage({
            id: `whisper-out-${Date.now()}`,
            room: RRC_WHISPERS_ROOM,
            kind: 'system',
            body: t('rrc.slash.msgSent', { name: label, text: parsed.text }),
            timestamp: Date.now(),
            dst_hash: resolved.identity_hash,
          });
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
          room: activeRoom && !activeRoom.startsWith('[') ? activeRoom : undefined,
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

      if (!activeRoom || activeRoom.startsWith('[')) {
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
      activeRoomInfo?.members,
      addMessage,
      appendSystemLines,
      capabilities.direct_notice,
      clearActiveRoomMessages,
      handleDisconnect,
      handlePart,
      joinRoom,
      rooms,
      setActiveRoom,
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

  const bannerText = moderationBanner
    ? moderationBanner.startsWith('rrc.')
      ? t(moderationBanner)
      : moderationBanner
    : null;

  return (
    <div className="bg-primary-dark flex h-full w-full min-w-0 text-amber-50">
      <RrcHubBrowser
        collapsed={collapsed}
        onToggleCollapsed={() => {
          setCollapsed((c) => {
            const next = !c;
            persistCollapsed(COLLAPSED_KEY, next);
            return next;
          });
        }}
        sidecarRunning={sidecarRunning}
        hubSearch={hubSearch}
        onHubSearchChange={setHubSearch}
        nickname={nickname}
        onNicknameChange={(v) => {
          setNickname(v);
          try {
            localStorage.setItem(NICK_KEY, v);
          } catch {
            // catch-no-log-ok
          }
        }}
        recommended={hubList.recommended}
        favourites={hubList.favourites}
        discovered={hubList.discovered}
        manual={hubList.manual}
        hubDestHash={hubDestHash}
        busy={busy}
        manualHash={manualHash}
        onManualHashChange={setManualHash}
        hubTab={hubTab}
        onHubTabChange={setHubTab}
        onRefresh={() => void refreshFromSidecar()}
        onConnect={(hash) => void handleConnect(hash)}
        onToggleFavorite={(hash, favorited) => void toggleFavorite(hash, favorited)}
        onManualConnect={() => void handleManualConnect()}
      />

      {connected && (
        <RrcRoomSidebar
          collapsed={roomListCollapsed}
          onToggleCollapsed={() => {
            setRoomListCollapsed((c) => {
              const next = !c;
              persistCollapsed(ROOM_LIST_COLLAPSED_KEY, next);
              return next;
            });
          }}
          roomSearch={roomSearch}
          onRoomSearchChange={setRoomSearch}
          joinRoomName={joinRoomName}
          onJoinRoomNameChange={setJoinRoomName}
          joinRoomKey={joinRoomKey}
          onJoinRoomKeyChange={setJoinRoomKey}
          busy={busy}
          onJoin={() => void joinRoom(joinRoomName, joinRoomKey)}
          onRefreshList={() => void sendHubCommand('/list')}
          joined={roomList}
          listed={listedRooms}
          favourites={roomFavourites}
          suggested={suggestedRooms}
          recent={recentNotJoined}
          activeRoom={activeRoom}
          unreadByRoom={unreadByRoom}
          onSelectRoom={(name, opts) => {
            if (opts?.join) void joinRoom(name);
            else setActiveRoom(name);
          }}
          onToggleFavourite={(name) => {
            if (!hubDestHash) return;
            toggleRrcRoomFavourite(hubDestHash, name);
            setPrefsEpoch((n) => n + 1);
          }}
          onToggleAutoJoin={(name) => {
            if (!hubDestHash) return;
            toggleRrcAutoJoinRoom(hubDestHash, name);
            setPrefsEpoch((n) => n + 1);
          }}
          autoJoin={autoJoinRooms}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-amber-800/40 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-amber-100">
              {hubName ?? hubDestHash ?? t('rrc.selectHubPrompt')}
            </div>
            <div className="text-xs text-amber-200/50">
              {t(`rrc.status.${status}`)}
              {activeRoom ? ` · ${activeRoom}` : ''}
              {capabilities.direct_notice ? ` · ${t('rrc.capDirectNotice')}` : ''}
            </div>
          </div>
          {connected && (
            <>
              <button
                type="button"
                className={`rounded p-1.5 hover:bg-amber-950/50 ${showTimestamps ? 'text-amber-400' : 'text-amber-200/60'}`}
                aria-label={t('rrc.toggleTimestamps')}
                onClick={() => {
                  setShowTimestamps(!showTimestamps);
                }}
              >
                <Clock size={16} />
              </button>
              <button
                type="button"
                className={`rounded p-1.5 hover:bg-amber-950/50 ${isMuted ? 'text-amber-400' : 'text-amber-200/60'}`}
                aria-label={isMuted ? t('rrc.unmuteRoom') : t('rrc.muteRoom')}
                disabled={!muteKey}
                onClick={toggleMute}
              >
                {isMuted ? <BellOff size={16} /> : <Bell size={16} />}
              </button>
              {activeRoom && !activeRoom.startsWith('[') && (
                <button
                  type="button"
                  className="rounded p-1.5 text-amber-200/60 hover:bg-amber-950/50"
                  aria-label={t('rrc.leaveRoom')}
                  disabled={busy}
                  onClick={() => void handlePart()}
                >
                  <LogOut size={16} />
                </button>
              )}
              <button
                type="button"
                className="rounded bg-amber-900/60 px-2 py-1 text-xs text-amber-100"
                aria-label={t('rrc.disconnect')}
                disabled={busy}
                onClick={() => void handleDisconnect()}
              >
                {t('rrc.disconnect')}
              </button>
            </>
          )}
        </header>
        {bannerText && (
          <div className="flex items-start gap-2 border-b border-amber-700/60 bg-amber-900/40 px-3 py-1.5 text-xs text-amber-100">
            <span className="min-w-0 flex-1">{bannerText}</span>
            <button
              type="button"
              className="shrink-0 p-0.5 text-amber-200/70 hover:text-amber-50"
              aria-label={t('rrc.dismissBanner')}
              onClick={() => {
                setModerationBanner(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {lastError && (
          <div className="border-b border-red-800/50 bg-red-900/30 px-3 py-1.5 text-xs text-red-200">
            {lastError}
          </div>
        )}
        <RrcTopicBar
          room={activeRoom}
          topic={activeRoomInfo?.topic}
          memberCount={activeRoomInfo?.members?.length ?? activeRoomInfo?.member_count}
        />
        <div className="flex min-h-0 flex-1">
          <RrcChatView
            connected={connected}
            activeRoom={activeRoom}
            messages={activeMessages}
            showTimestamps={showTimestamps}
            draft={draft}
            onDraftChange={setDraft}
            onSend={(text) => void handleSend(text)}
            canSend={status === 'active'}
            isMuted={isMuted}
          />
          {showNicklist && (
            <RrcNickList
              members={activeRoomInfo?.members ?? []}
              busy={busy}
              onRefreshWho={() => {
                const room = activeRoom;
                if (!room || room.startsWith('[')) return;
                void sendHubCommand(`/who ${room}`);
              }}
              onNickClick={(member: RrcRoomMember) => {
                const label = member.nickname || member.identity_hash.slice(0, 8);
                setDraft(`/msg ${label} `);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
