import { Bell, BellOff, Clock, LogOut, Trash2, X } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal } from '@/renderer/components/ConfirmModal';
import { RrcChatView } from '@/renderer/components/rrc/RrcChatView';
import { RrcHubBrowser } from '@/renderer/components/rrc/RrcHubBrowser';
import { RrcNickList } from '@/renderer/components/rrc/RrcNickList';
import { RrcRoomSidebar } from '@/renderer/components/rrc/RrcRoomSidebar';
import { RrcTopicBar } from '@/renderer/components/rrc/RrcTopicBar';
import { runRrcHubAutoConnectBatch } from '@/renderer/hooks/useRrcStartupAutoConnect';
import { loadMutedViews, saveMutedViews } from '@/renderer/lib/chatPanelProtocolStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { formatRrcErrorMessage } from '@/renderer/lib/rrcErrorHumanize';
import { setRrcHubDisconnectSuppressed } from '@/renderer/lib/rrcHubDisconnectSuppress';
import { isRrcHubAutoJoin, toggleRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { isRrcHubLinked } from '@/renderer/lib/rrcHubSession';
import { loadRrcRecentRooms, pushRrcRecentRoom } from '@/renderer/lib/rrcRecentRooms';
import { clearRrcRoomHistory, hydrateRrcRoomMessages } from '@/renderer/lib/rrcRoomHistory';
import { dedupeRrcMembers, rrcIdentityHashesMatch } from '@/renderer/lib/rrcRoomMembers';
import { resolveRrcJoinRoomName, rrcRoomMatchKey, rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import {
  loadRrcAutoJoinRooms,
  loadRrcRoomFavourites,
  toggleRrcAutoJoinRoom,
  toggleRrcRoomFavourite,
} from '@/renderer/lib/rrcRoomPrefs';
import {
  parseRrcSlashInput,
  resolveRrcMsgTarget,
  RRC_HELP_I18N_KEYS,
} from '@/renderer/lib/rrcSlashCommands';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import {
  MAX_RRC_HUB_SESSIONS,
  RRC_HUB_STREAM_ROOM,
  RRC_NICKNAME_STORAGE_KEY,
  RRC_WHISPERS_ROOM,
  useRrcSessionStore,
} from '@/renderer/stores/rrcSessionStore';
import type { RrcHubInfo, RrcRoomMember } from '@/shared/rrc-types';

const COLLAPSED_KEY = 'mesh-client:rrcHubListCollapsed';
const ROOM_LIST_COLLAPSED_KEY = 'mesh-client:rrc:roomListCollapsed';
const NICK_LIST_COLLAPSED_KEY = 'mesh-client:rrc:nickListCollapsed';
const NICK_KEY = RRC_NICKNAME_STORAGE_KEY;

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
  /** Keep RRC per-message copy visible (same App Appearance setting as Chat). */
  alwaysShowMessageActions?: boolean;
}

export default function RrcPanel({ isActive, alwaysShowMessageActions = false }: RrcPanelProps) {
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
  const sessionsByHub = useRrcSessionStore((s) => s.sessionsByHub);
  const showTimestamps = useRrcSessionStore((s) => s.showTimestamps);
  const capabilities = useRrcSessionStore((s) => s.capabilities);
  const setNickname = useRrcSessionStore((s) => s.setNickname);
  const setFocusedHub = useRrcSessionStore((s) => s.setFocusedHub);
  const setActiveRoom = useRrcSessionStore((s) => s.setActiveRoom);
  const setShowTimestamps = useRrcSessionStore((s) => s.setShowTimestamps);
  const clearUnread = useRrcSessionStore((s) => s.clearUnread);
  const clearActiveRoomMessages = useRrcSessionStore((s) => s.clearActiveRoomMessages);
  const addMessage = useRrcSessionStore((s) => s.addMessage);
  const messagesForActiveRoom = useRrcSessionStore((s) => s.messagesForActiveRoom);
  const markPartIntent = useRrcSessionStore((s) => s.markPartIntent);
  const localIdentityHash = useRrcSessionStore((s) => s.localIdentityHash);
  const setDisconnectIntent = useRrcSessionStore((s) => s.setDisconnectIntent);
  const setModerationBanner = useRrcSessionStore((s) => s.setModerationBanner);
  const setError = useRrcSessionStore((s) => s.setError);
  const clearHubSession = useRrcSessionStore((s) => s.clearHubSession);

  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(COLLAPSED_KEY));
  const [roomListCollapsed, setRoomListCollapsed] = useState(() =>
    readCollapsed(ROOM_LIST_COLLAPSED_KEY),
  );
  const [nickListCollapsed, setNickListCollapsed] = useState(() =>
    readCollapsed(NICK_LIST_COLLAPSED_KEY),
  );
  const [hubTab, setHubTab] = useState<'favourites' | 'discovered'>('favourites');
  const [hubSearch, setHubSearch] = useState('');
  const [roomSearch, setRoomSearch] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [joinRoomName, setJoinRoomName] = useState('lobby');
  const [joinRoomKey, setJoinRoomKey] = useState('');
  const [recentRoomsEpoch, setRecentRoomsEpoch] = useState(0);
  const [prefsEpoch, setPrefsEpoch] = useState(0);
  const [hubAutoJoinEpoch, setHubAutoJoinEpoch] = useState(0);
  /** Short-lived join/part only — never block the whole panel on connect. */
  const [actionBusy, setActionBusy] = useState(false);
  const [mutedViews, setMutedViews] = useState(() => loadMutedViews('reticulum'));
  const [draft, setDraft] = useState('');
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  /** Per-hub room keys we already requested `/who` for (rrcd JOINED often has no roster). */
  const whoRequestedRef = useRef(new Set<string>());

  useEffect(() => {
    try {
      const nick = localStorage.getItem(NICK_KEY);
      if (nick) setNickname(nick);
    } catch {
      // catch-no-log-ok localStorage may be unavailable
    }
  }, [setNickname]);

  useEffect(() => {
    if (!hubDestHash || !activeRoom) return;
    void hydrateRrcRoomMessages(hubDestHash, activeRoom);
  }, [hubDestHash, activeRoom]);

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
      try {
        const running = await isReticulumSidecarRunning();
        if (!cancelled) {
          setSidecarRunning(running);
          if (running) await refreshFromSidecar();
        }
      } catch (e) {
        console.debug('[RrcPanel] sidecar status ' + errLikeToLogString(e));
      }
    })();
    const unsub = window.electronAPI.reticulum.onStatus((s) => {
      setSidecarRunning(s.running);
      if (s.running) {
        void refreshFromSidecar().catch((e: unknown) => {
          console.debug('[RrcPanel] refresh on status ' + errLikeToLogString(e));
        });
      }
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
      if (status !== 'active' || !hubDestHash) return;
      await window.electronAPI.reticulum.rrc.send({
        hub_dest_hash: hubDestHash,
        room: activeRoom && !activeRoom.startsWith('[') ? activeRoom : undefined,
        body,
        type: 'msg',
      });
    },
    [activeRoom, hubDestHash, status],
  );

  useEffect(() => {
    if (sessionsByHub.size === 0) {
      whoRequestedRef.current.clear();
    }
  }, [sessionsByHub]);

  const requestRoomWho = useCallback(
    (roomRaw: string, force = false) => {
      if (status !== 'active' || !hubDestHash) return;
      const room = resolveRrcJoinRoomName(roomRaw, {
        listed: listedRooms,
        joined: [...rooms.keys()].map((name) => ({ name })),
      });
      if (!room || room.startsWith('[')) return;
      const reqKey = `${hubDestHash}::${rrcRoomMatchKey(room)}`;
      if (!force && whoRequestedRef.current.has(reqKey)) return;
      whoRequestedRef.current.add(reqKey);
      void window.electronAPI.reticulum.rrc
        .send({ hub_dest_hash: hubDestHash, room, body: `/who ${room}`, type: 'msg' })
        .catch((e: unknown) => {
          whoRequestedRef.current.delete(reqKey);
          console.debug('[RrcPanel] /who ' + errLikeToLogString(e));
        });
    },
    [status, hubDestHash, listedRooms, rooms],
  );

  // rrcd JOINED member lists are optional (off by default) — request `/who` per joined room.
  useEffect(() => {
    if (status !== 'active' || !hubDestHash) return;
    const live = new Set<string>();
    for (const key of rooms.keys()) {
      if (!key || key.startsWith('[')) continue;
      const reqKey = `${hubDestHash}::${rrcRoomMatchKey(key)}`;
      live.add(reqKey);
      requestRoomWho(key, false);
    }
    // Drop parted rooms so a later re-join triggers a fresh `/who`.
    for (const prev of [...whoRequestedRef.current]) {
      if (prev.startsWith(`${hubDestHash}::`) && !live.has(prev)) {
        whoRequestedRef.current.delete(prev);
      }
    }
  }, [status, hubDestHash, rooms, requestRoomWho]);

  const hubList = useMemo(() => {
    const all = [...hubs.values()].filter((h) => hubMatchesSearch(h, hubSearch));
    const favourites = all.filter((h) => h.favorited);
    const discovered = all.filter(
      (h) => !h.favorited && (h.source === 'discovered' || h.source === 'manual' || h.hops != null),
    );
    return { favourites, discovered };
  }, [hubs, hubSearch]);

  const roomList = useMemo(() => {
    const list = [...rooms.values()];
    const keys = new Set(list.map((r) => rrcRoomMatchKey(r.name)));
    const ensureSynthetic = (name: string) => {
      if (keys.has(rrcRoomMatchKey(name))) return;
      let unread = 0;
      for (const [room, count] of unreadByRoom) {
        if (rrcRoomMatchKey(room) === rrcRoomMatchKey(name)) unread += count;
      }
      if (unread > 0 || (activeRoom != null && rrcRoomsMatch(activeRoom, name))) {
        list.push({ name, members: [], member_count: 0 });
        keys.add(rrcRoomMatchKey(name));
      }
    };
    ensureSynthetic(RRC_WHISPERS_ROOM);
    ensureSynthetic(RRC_HUB_STREAM_ROOM);
    return list;
  }, [rooms, unreadByRoom, activeRoom]);

  const unreadForHub = useRrcSessionStore((s) => s.unreadForHub);

  const joinedKeys = useMemo(
    () => new Set([...rooms.keys()].map((k) => rrcRoomMatchKey(k))),
    [rooms],
  );

  const recentNotJoined = useMemo(
    () =>
      recentRooms.filter(
        (r) =>
          !joinedKeys.has(rrcRoomMatchKey(r)) && !listedRooms.some((l) => rrcRoomsMatch(l.name, r)),
      ),
    [recentRooms, joinedKeys, listedRooms],
  );

  const activeMessages = messagesForActiveRoom();
  const activeRoomInfo = activeRoom ? rooms.get(activeRoom) : undefined;
  const muteKey = hubDestHash && activeRoom ? `rrc:${hubDestHash}:${activeRoom}` : null;
  const isMuted = muteKey ? mutedViews.has(muteKey) : false;
  const connected =
    status === 'active' || status === 'awaiting_welcome' || status === 'reconnecting';
  const connectInFlight = status === 'connecting' || status === 'awaiting_welcome';
  /** Cancel/disconnect while connecting — hubs stay clickable (do not gate on connectInFlight). */
  const canCancelSession =
    status === 'connecting' ||
    status === 'awaiting_welcome' ||
    status === 'reconnecting' ||
    status === 'active';
  const cancelSessionLabel = connectInFlight || status === 'reconnecting';
  const showNicklist =
    Boolean(activeRoom) && activeRoom !== RRC_HUB_STREAM_ROOM && !activeRoom?.startsWith('[');

  const nicklistMembers = useMemo(() => {
    let members = dedupeRrcMembers([...(activeRoomInfo?.members ?? [])]);
    if (localIdentityHash || nickname) {
      const selfIdx = members.findIndex((m) => {
        if (localIdentityHash && rrcIdentityHashesMatch(m.identity_hash, localIdentityHash)) {
          return true;
        }
        return Boolean(
          nickname && m.nickname?.trim().toLowerCase() === nickname.trim().toLowerCase(),
        );
      });
      if (selfIdx >= 0) {
        const cur = members[selfIdx];
        if (cur) {
          members[selfIdx] = {
            identity_hash:
              localIdentityHash && rrcIdentityHashesMatch(cur.identity_hash, localIdentityHash)
                ? localIdentityHash.length >= cur.identity_hash.length
                  ? localIdentityHash
                  : cur.identity_hash
                : cur.identity_hash,
            nickname: nickname || cur.nickname,
          };
        }
      } else if (nickname) {
        members = [
          {
            identity_hash: localIdentityHash ?? `nick:${nickname.toLowerCase()}`,
            nickname,
          },
          ...members,
        ];
      }
      members = dedupeRrcMembers(members);
    }
    return members;
  }, [activeRoomInfo?.members, localIdentityHash, nickname]);

  const displayError = lastError ? formatRrcErrorMessage(lastError, t) : null;

  const handleConnect = useCallback(
    async (hash: string, opts?: { focus?: boolean }) => {
      const target = hash.trim().toLowerCase();
      if (!target) return;
      const wantFocus = opts?.focus !== false;
      const session = useRrcSessionStore.getState();
      const existing = session.sessionsByHub.get(target);
      // Already tracked and connecting/active — just bring it into focus, never re-connect.
      if (existing && isRrcHubLinked(existing.status)) {
        if (wantFocus) setFocusedHub(target);
        return;
      }
      if (!existing && session.sessionsByHub.size >= MAX_RRC_HUB_SESSIONS) {
        // Surface on whichever hub is currently focused — do not create a phantom session slot.
        setError(t('rrc.maxHubsConnected'));
        return;
      }
      // Auto-connect batch should not steal focus; still focus when nothing is selected.
      if (wantFocus || !session.focusedHubHash) {
        setFocusedHub(target);
      }
      // Optimistic UI so Cancel appears immediately (sidecar may still be aborting prior connect);
      // this also creates the hub's session before the intent/error mutations below.
      useRrcSessionStore.getState().applyStatus('connecting', target, null);
      setRrcHubDisconnectSuppressed(target, false);
      setDisconnectIntent(false, target);
      setError(null, target);
      try {
        const res = await window.electronAPI.reticulum.rrc.connect({
          dest_hash: target,
          nickname,
        });
        if (!res.ok) {
          const err = res.error ?? t('rrc.connectFailed');
          // Superseded by Cancel or a newer hub selection — not a user-facing failure.
          if (/cancelled/i.test(err)) return;
          setError(formatRrcErrorMessage(err, t), target);
          // Sidecar may not emit disconnect for HTTP-level reject; clear optimistic connecting.
          const cur = useRrcSessionStore.getState().sessionsByHub.get(target);
          if (cur?.status === 'connecting' || cur?.status === 'awaiting_welcome') {
            useRrcSessionStore.getState().clearHubSession(target);
          }
        }
      } catch (e) {
        const msg = errLikeToLogString(e);
        if (/cancelled/i.test(msg)) return;
        // catch-no-log-ok error surfaced via setError
        setError(formatRrcErrorMessage(msg, t), target);
        const cur = useRrcSessionStore.getState().sessionsByHub.get(target);
        if (cur?.status === 'connecting' || cur?.status === 'awaiting_welcome') {
          useRrcSessionStore.getState().clearHubSession(target);
        }
      }
    },
    [nickname, setDisconnectIntent, setError, setFocusedHub, t],
  );

  // Batch-connect hubs marked for auto-join when the Reticulum stack is up.
  // Shared with App-level useRrcStartupAutoConnect so cold start works without this panel.
  useEffect(() => {
    if (!sidecarRunning) return;
    void hubAutoJoinEpoch;
    void runRrcHubAutoConnectBatch(nickname);
    // Do not depend on sessionsByHub — clearHubSession after Disconnect must not re-fire auto-join.
  }, [sidecarRunning, hubAutoJoinEpoch, nickname]);

  const handleDisconnect = useCallback(async () => {
    const target = hubDestHash;
    if (!target) return;
    setDisconnectIntent(true, target);
    try {
      const res = await window.electronAPI.reticulum.rrc.disconnect({ dest_hash: target });
      if (!res.ok) {
        setDisconnectIntent(false, target);
        setError(t('rrc.disconnectFailed'), target);
        return;
      }
      setRrcHubDisconnectSuppressed(target, true);
      clearHubSession(target);
    } catch (e) {
      console.warn('[RrcPanel] disconnect ' + errLikeToLogString(e));
      setDisconnectIntent(false, target);
      setError(formatRrcErrorMessage(errLikeToLogString(e), t), target);
    }
  }, [clearHubSession, hubDestHash, setDisconnectIntent, setError, t]);

  const handleManualConnect = useCallback(async () => {
    const hub = await upsertManual(manualHash);
    if (!hub) {
      setError(t('rrc.invalidHubHash'));
      return;
    }
    setManualHash('');
    await handleConnect(hub.destination_hash);
  }, [manualHash, upsertManual, handleConnect, setError, t]);

  const joinRoom = useCallback(
    async (roomRaw: string, key?: string) => {
      if (!hubDestHash) return;
      const room = resolveRrcJoinRoomName(roomRaw, {
        listed: listedRooms,
        joined: [...rooms.keys()].map((name) => ({ name })),
      });
      if (!room) return;
      // Already in this channel (possibly under `#name` vs `name`) — focus + refresh roster.
      const existingKey = [...rooms.keys()].find((k) => rrcRoomsMatch(k, room));
      if (existingKey) {
        setActiveRoom(existingKey);
        requestRoomWho(existingKey, true);
        return;
      }
      setActionBusy(true);
      try {
        const res = await window.electronAPI.reticulum.rrc.join({
          hub_dest_hash: hubDestHash,
          room,
          key: key?.trim() || undefined,
        });
        if (!res.ok) {
          setError(formatRrcErrorMessage(res.error ?? t('rrc.joinFailed'), t));
        } else {
          setActiveRoom(room);
          pushRrcRecentRoom(hubDestHash, rrcRoomMatchKey(room));
          setRecentRoomsEpoch((n) => n + 1);
          // Always refresh people list — rrcd JOINED often has no member body.
          requestRoomWho(room, true);
        }
      } catch (e) {
        // catch-no-log-ok error surfaced via setError
        setError(formatRrcErrorMessage(errLikeToLogString(e), t));
      } finally {
        setActionBusy(false);
      }
    },
    [hubDestHash, listedRooms, rooms, requestRoomWho, setActiveRoom, setError, t],
  );

  const handlePart = useCallback(
    async (room?: string) => {
      if (!hubDestHash) return;
      const raw = (room ?? activeRoom)?.trim();
      if (!raw || raw.startsWith('[')) return;
      // Wire PART must use the same spelling as JOIN (rrcd treats #general ≠ general).
      const joinedKey = [...rooms.keys()].find((k) => rrcRoomsMatch(k, raw));
      const target =
        joinedKey ??
        resolveRrcJoinRoomName(raw, {
          listed: listedRooms,
          joined: [...rooms.values()],
        });
      if (!target) return;
      markPartIntent(target);
      setActionBusy(true);
      try {
        const res = await window.electronAPI.reticulum.rrc.part({
          hub_dest_hash: hubDestHash,
          room: target,
        });
        if (!res.ok) {
          useRrcSessionStore.getState().clearPartIntent(target);
          setError(formatRrcErrorMessage(res.error ?? t('rrc.partFailed'), t));
        }
      } catch (e) {
        console.warn('[RrcPanel] part ' + errLikeToLogString(e));
        useRrcSessionStore.getState().clearPartIntent(target);
        setError(formatRrcErrorMessage(errLikeToLogString(e), t));
      } finally {
        setActionBusy(false);
      }
    },
    [activeRoom, hubDestHash, listedRooms, markPartIntent, rooms, setError, t],
  );

  const appendSystemLines = useCallback(
    (lines: string[]) => {
      const room = activeRoom ?? RRC_HUB_STREAM_ROOM;
      if (!activeRoom) setActiveRoom(RRC_HUB_STREAM_ROOM);
      for (const line of lines) {
        addMessage({
          id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, // NOSONAR non-crypto local UI row id
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
      try {
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
            if (status === 'active' && hubDestHash) {
              const nickRes = await window.electronAPI.reticulum.rrc.setNickname({
                nickname: parsed.nickname,
                hub_dest_hash: hubDestHash,
              });
              if (!nickRes.ok) {
                useRrcSessionStore.getState().setError(nickRes.error ?? t('rrc.sendFailed'));
                return;
              }
              // Push K_NICK to the hub so /who and member lists pick up the new nick.
              void sendHubCommand('/who').catch((e: unknown) => {
                console.debug('[RrcPanel] nick /who ' + errLikeToLogString(e));
              });
            }
            // Update local nicklist entry for self immediately.
            const selfHash = useRrcSessionStore.getState().localIdentityHash;
            if (selfHash && activeRoom && !activeRoom.startsWith('[')) {
              const members = activeRoomInfo?.members ?? [];
              const next = members.map((m) =>
                m.identity_hash.toLowerCase() === selfHash
                  ? { ...m, nickname: parsed.nickname }
                  : m,
              );
              if (!next.some((m) => m.identity_hash.toLowerCase() === selfHash)) {
                next.push({ identity_hash: selfHash, nickname: parsed.nickname });
              }
              useRrcSessionStore.getState().mergeRoomMembers(activeRoom, next, 'replace');
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
            if (status !== 'active' || !hubDestHash) {
              useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
              return;
            }
            if (!activeRoom || activeRoom.startsWith('[')) {
              useRrcSessionStore.getState().setError(t('rrc.joinRoomPrompt'));
              return;
            }
            const res = await window.electronAPI.reticulum.rrc.send({
              hub_dest_hash: hubDestHash,
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
            if (status !== 'active' || !hubDestHash) {
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
              hub_dest_hash: hubDestHash,
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
          if (status !== 'active' || !hubDestHash) {
            useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
            return;
          }
          const res = await window.electronAPI.reticulum.rrc.send({
            hub_dest_hash: hubDestHash,
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
        if (status !== 'active' || !hubDestHash) {
          useRrcSessionStore.getState().setError(t('rrc.sendFailed'));
          return;
        }
        const res = await window.electronAPI.reticulum.rrc.send({
          hub_dest_hash: hubDestHash,
          room: activeRoom,
          body: parsed.body,
          type: 'msg',
        });
        if (!res.ok) {
          useRrcSessionStore.getState().setError(res.error ?? t('rrc.sendFailed'));
          return;
        }
        setDraft('');
      } catch (e) {
        console.warn('[RrcPanel] send ' + errLikeToLogString(e));
        useRrcSessionStore.getState().setError(formatRrcErrorMessage(errLikeToLogString(e), t));
      }
    },
    [
      activeRoom,
      activeRoomInfo,
      addMessage,
      appendSystemLines,
      capabilities.direct_notice,
      clearActiveRoomMessages,
      handleDisconnect,
      handlePart,
      hubDestHash,
      joinRoom,
      rooms,
      sendHubCommand,
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
        favourites={hubList.favourites}
        discovered={hubList.discovered}
        hubDestHash={hubDestHash}
        unreadForHub={unreadForHub}
        statusForHub={(hash) => {
          const key = hash.trim().toLowerCase();
          return sessionsByHub.get(key)?.status ?? null;
        }}
        isHubAutoJoin={(hash) => {
          void hubAutoJoinEpoch;
          return isRrcHubAutoJoin(hash);
        }}
        manualHash={manualHash}
        onManualHashChange={setManualHash}
        hubTab={hubTab}
        onHubTabChange={setHubTab}
        onRefresh={() => void refreshFromSidecar()}
        onConnect={(hash) => void handleConnect(hash)}
        onToggleFavorite={(hash, favorited) => void toggleFavorite(hash, favorited)}
        onToggleAutoJoin={(hash) => {
          toggleRrcHubAutoJoin(hash);
          setHubAutoJoinEpoch((n) => n + 1);
        }}
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
          busy={actionBusy}
          onJoin={() => void joinRoom(joinRoomName, joinRoomKey)}
          onRefreshList={() => void sendHubCommand('/list')}
          joined={roomList}
          listed={listedRooms}
          favourites={roomFavourites}
          recent={recentNotJoined}
          activeRoom={activeRoom}
          unreadByRoom={unreadByRoom}
          onSelectRoom={(name, opts) => {
            if (opts?.join) {
              void joinRoom(name);
              return;
            }
            const existingKey = [...rooms.keys()].find((k) => rrcRoomsMatch(k, name));
            setActiveRoom(existingKey ?? name);
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
                title={t('rrc.toggleTimestamps')}
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
                title={isMuted ? t('rrc.unmuteRoom') : t('rrc.muteRoom')}
                disabled={!muteKey}
                onClick={toggleMute}
              >
                {isMuted ? <BellOff size={16} /> : <Bell size={16} />}
              </button>
              {activeRoom && (
                <button
                  type="button"
                  className="rounded p-1.5 text-amber-200/60 hover:bg-amber-950/50"
                  aria-label={t('rrc.clearHistory')}
                  title={t('rrc.clearHistory')}
                  disabled={actionBusy}
                  onClick={() => {
                    setConfirmClearHistory(true);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
              {activeRoom && !activeRoom.startsWith('[') && (
                <button
                  type="button"
                  className="rounded p-1.5 text-amber-200/60 hover:bg-amber-950/50"
                  aria-label={t('rrc.leaveRoom')}
                  title={t('rrc.leaveRoom')}
                  disabled={actionBusy}
                  onClick={() => void handlePart()}
                >
                  <LogOut size={16} />
                </button>
              )}
            </>
          )}
          {canCancelSession && (
            <button
              type="button"
              className="rounded bg-amber-900/60 px-2 py-1 text-xs text-amber-100"
              aria-label={cancelSessionLabel ? t('rrc.cancelConnect') : t('rrc.disconnect')}
              title={cancelSessionLabel ? t('rrc.cancelConnect') : t('rrc.disconnect')}
              disabled={actionBusy}
              onClick={() => void handleDisconnect()}
            >
              {cancelSessionLabel ? t('rrc.cancelConnect') : t('rrc.disconnect')}
            </button>
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
        {displayError && (
          <div className="flex items-start gap-2 border-b border-red-800/50 bg-red-900/30 px-3 py-1.5 text-xs text-red-200">
            <span className="min-w-0 flex-1">{displayError}</span>
            <button
              type="button"
              className="shrink-0 p-0.5 text-red-200/70 hover:text-red-50"
              aria-label={t('rrc.dismissBanner')}
              onClick={() => {
                setError(null);
              }}
            >
              <X size={14} />
            </button>
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
            nickname={nickname}
            alwaysShowMessageActions={alwaysShowMessageActions}
          />
          {showNicklist && (
            <RrcNickList
              collapsed={nickListCollapsed}
              onToggleCollapsed={() => {
                setNickListCollapsed((c) => {
                  const next = !c;
                  persistCollapsed(NICK_LIST_COLLAPSED_KEY, next);
                  return next;
                });
              }}
              members={nicklistMembers}
              busy={actionBusy}
              onRefreshWho={() => {
                const room = activeRoom;
                if (!room || room.startsWith('[')) return;
                requestRoomWho(room, true);
              }}
              onNickClick={(member: RrcRoomMember) => {
                const label = member.nickname || member.identity_hash.slice(0, 8);
                setDraft(`/msg ${label} `);
              }}
            />
          )}
        </div>
      </main>
      {confirmClearHistory && hubDestHash && activeRoom && (
        <ConfirmModal
          title={t('rrc.clearHistoryTitle')}
          message={t('rrc.clearHistoryConfirm', { room: activeRoom })}
          confirmLabel={t('rrc.clearHistoryConfirmAction')}
          danger
          onCancel={() => {
            setConfirmClearHistory(false);
          }}
          onConfirm={() => {
            setConfirmClearHistory(false);
            void clearRrcRoomHistory(hubDestHash, activeRoom);
          }}
        />
      )}
    </div>
  );
}
