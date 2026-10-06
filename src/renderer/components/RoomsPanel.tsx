/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual useVirtualizer; same as ChatPanel */
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TFunction } from 'i18next';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  Info,
  LogOut,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  PARENT_HOVER_ATTR,
  RotateCw,
  Search,
  Star,
  Wrench,
  X,
} from 'lucide-react-motion';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useMeshcoreRoomLoginQueueRevision } from '@/renderer/hooks/useMeshcoreRoomLoginQueueRevision';
import { useMeshcoreRoomSessionRevision } from '@/renderer/hooks/useMeshcoreRoomSessionRevision';
import { useAppWindowActivity } from '@/renderer/lib/appWindowActivity';
import {
  loadMutedViews,
  loadPersistedRoomsLastRead,
  loadStarred,
  mergeRoomLastReadWatermark,
  notifyPersistedRoomsLastReadChanged,
  saveMutedViews,
  savePersistedRoomsLastRead,
  saveStarred,
  type StarredMessage,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { ROOM_LOGIN_PROGRESS_DOT } from '@/renderer/lib/connectionHeaderStatus';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { translateMeshcoreUserMessage } from '@/renderer/lib/meshcore/meshcoreMessageI18n';
import {
  repairMeshcoreHydrationStaleRoomSends,
  repairMeshcoreRoomUnknownSenderNames,
} from '@/renderer/lib/meshcoreDbCacheHydration';
import {
  type MeshcoreRoomAclEntry,
  meshcoreRoomAclLevelLabel,
  parseMeshcoreRoomAclResponse,
} from '@/renderer/lib/meshcoreRoomAclParser';
import {
  clearMeshcoreRoomAutoLoginFailure,
  getMeshcoreRoomAutoLoginFailure,
  subscribeMeshcoreRoomAutoLoginFailureChanges,
} from '@/renderer/lib/meshcoreRoomAutoLoginFailure';
import { mergeDisplayedRoomPostChunks } from '@/renderer/lib/meshcoreRoomChunkMerge';
import {
  listMeshcoreRoomCredentialNodeIds,
  setMeshcoreRoomCredential,
} from '@/renderer/lib/meshcoreRoomCredentialStorage';
import {
  getMeshcoreRoomLoginQueueSnapshot,
  meshcoreIsRoomLoginQueued,
  meshcoreRoomLoginQueueSize,
} from '@/renderer/lib/meshcoreRoomLoginQueue';
import {
  disableMeshcoreRoomAutoLogin,
  forgetMeshcoreRoomSavedSecrets,
  getMeshcoreRoomSavedSecretsSummary,
} from '@/renderer/lib/meshcoreRoomSavedSecrets';
import {
  meshcoreCancelAllRoomLogins,
  meshcoreGetRoomSession,
  meshcoreIsRoomLoggedIn,
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomCanAdmin,
  meshcoreRoomCanPost,
  meshcoreRoomEffectiveGuestPassword,
} from '@/renderer/lib/meshcoreRoomSession';
import { resolveMeshcoreRoomSidebarMarker } from '@/renderer/lib/meshcoreRoomSidebarMarker';
import { computeRoomUnreadCounts } from '@/renderer/lib/meshcoreRoomsUnread';
import {
  getMeshcoreRoomLastPostAt,
  getMeshcoreRoomSyncConfig,
  setMeshcoreRoomSyncConfig,
} from '@/renderer/lib/meshcoreRoomSyncStorage';
import { isMeshcoreDmExcludedHwModel } from '@/renderer/lib/meshcoreUtils';
import { clampReadWatermarkMs, effectiveMessageTimestampMs } from '@/renderer/lib/nodeStatus';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { formatIsoDate, formatIsoDateTime } from '@/shared/formatIsoDate';
import { touch } from '@/shared/touch';

import {
  CHAT_SCROLL_END_THRESHOLD,
  CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX,
  createChatScrollAdjustPredicate,
  createStableChatMeasureElement,
  estimateChatRowHeight,
  findFirstMessageIndexByDayKey,
  findIndexByRowKey,
  getChatDayKey,
  getDistFromChatBottom,
  roomPostRowKey,
  roomPostVirtualizerKey,
  scheduleVirtualRowRemeasure,
} from '../lib/chatScrollUtils';
import { ConversationLayout, useConversationLayoutMode } from './chat/ConversationLayout';
import { ChatComposer } from './ChatComposer';
import { ChatPayloadText } from './ChatPayloadText';
import { ConfirmModal } from './ConfirmModal';
import { MessageStatusBadge } from './MessageStatusBadge';
import { useToast } from './Toast';
import { Button, IconButton } from './ui/Button';
import {
  CHECKBOX_CLASS,
  FIELD_LABEL_CLASS,
  INPUT_CLASS,
  NOTICE_CLASS,
  SELECT_CLASS,
} from './ui/formClasses';
import { MenuButton, type MenuEntry } from './ui/Menu';
import { StatusDot } from './ui/StatusDot';
import { Switch } from './ui/Switch';

function RoomUnreadDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-red-500/50" />
      <span className="text-label shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 font-semibold text-red-300">
        {label}
      </span>
      <div className="flex-1 border-t border-red-500/50" />
    </div>
  );
}

function formatDayLabel(ts: number, t: TFunction): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - msgDay.getTime();
  if (diff === 0) return t('chatPanel.dayToday');
  if (diff === 86_400_000) return t('chatPanel.dayYesterday');
  return formatIsoDate(date);
}

const ROOMS_LIST_COLLAPSED_STORAGE_KEY = 'mesh-client:roomsListCollapsed';
/** Room details side panel (sync settings, members): docked open unless the user hid it. */
const ROOMS_DETAILS_COLLAPSED_STORAGE_KEY = 'mesh-client:rooms:detailsCollapsed';

function readDetailsPinned(): boolean {
  try {
    return localStorage.getItem(ROOMS_DETAILS_COLLAPSED_STORAGE_KEY) !== 'true';
  } catch {
    // catch-no-log-ok localStorage may be unavailable
    return true;
  }
}

interface Props {
  nodes: Map<number, MeshNode>;
  messages: ChatMessage[];
  myNodeNum: number;
  isConnected: boolean;
  connectionType?: 'ble' | 'serial' | 'http' | 'tcp' | null;
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
      forceRelogin?: boolean;
    },
  ) => Promise<void>;
  onLoginAllSaved?: (roomNodeIds: number[]) => Promise<void>;
  onCancelRoomLogin: (nodeId: number) => void;
  onLeaveRoom: (nodeId: number) => Promise<void>;
  onSendRoomPost: (nodeId: number, text: string) => Promise<void>;
  onSendRoomAdminCli: (nodeId: number, command: string) => Promise<string>;
  /** Jump to Repeaters & Rooms ops for this room (infrastructure CLI / ACL). */
  onOpenRepeaterOps?: (nodeId: number) => void;
  onMessageNode?: (nodeNum: number) => void;
  onToggleFavorite?: (nodeId: number, favorited: boolean) => void;
  /** Ref for scroll-to-top (Rooms tab inner message stream). */
  scrollToTopRef?: React.RefObject<(() => void) | null>;
  /** Main app scrollport for distance-from-bottom when outer viewport scrolls. */
  outerScrollMetricsRootRef?: React.RefObject<HTMLElement | null>;
  /** Denser post bubbles (same App Appearance setting as Chat). */
  compactMode?: boolean;
  /** Keep the per-post action row visible instead of hover/focus-only (same App Appearance setting as Chat). */
  alwaysShowMessageActions?: boolean;
}

function formatTimestamp(ts: number): string {
  return formatIsoDateTime(ts);
}

function roomMsgStarId(m: ChatMessage): string {
  return roomPostRowKey(m);
}

function canDmMeshcorePoster(
  senderId: number,
  myNodeNum: number,
  nodes: Map<number, MeshNode>,
): boolean {
  if (senderId === 0 || senderId === myNodeNum) return false;
  const node = nodes.get(senderId);
  if (!node || isMeshcoreDmExcludedHwModel(node.hw_model)) return false;
  return Boolean(node.public_key_hex?.trim());
}

interface RecognizedPoster {
  senderId: number;
  senderName: string;
  lastPostAt: number;
  node?: MeshNode;
}

function buildRecognizedPosters(
  roomPosts: ChatMessage[],
  nodes: Map<number, MeshNode>,
  unknownLabel: string,
): RecognizedPoster[] {
  const byId = new Map<number, RecognizedPoster>();
  for (const m of roomPosts) {
    if (m.sender_id === 0) continue;
    const existing = byId.get(m.sender_id);
    if (!existing || m.timestamp > existing.lastPostAt) {
      byId.set(m.sender_id, {
        senderId: m.sender_id,
        senderName: m.sender_name || nodes.get(m.sender_id)?.long_name || unknownLabel,
        lastPostAt: m.timestamp,
        node: nodes.get(m.sender_id),
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.lastPostAt - a.lastPostAt);
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
  onLoginAllSaved,
  onCancelRoomLogin,
  onLeaveRoom,
  onSendRoomPost,
  onSendRoomAdminCli,
  onOpenRepeaterOps,
  onMessageNode,
  onToggleFavorite,
  scrollToTopRef,
  outerScrollMetricsRootRef,
  compactMode = false,
  alwaysShowMessageActions = false,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { inactive: appWindowInactive } = useAppWindowActivity();
  const parentIconTrigger = useParentIconTrigger();
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(
    () => initialRoomTarget ?? null,
  );
  const selectedRoomIdRef = useRef(selectedRoomId);
  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);
  const [loginPassword, setLoginPassword] = useState('');
  /** Tracks in-flight login promises before the shared queue snapshot updates (tests / fast paths). */
  const [localLoginRoomIds, setLocalLoginRoomIds] = useState<Set<number>>(() => new Set());
  const [leaveLoadingRoomIds, setLeaveLoadingRoomIds] = useState<Set<number>>(() => new Set());
  const [loginErrorsByRoom, setLoginErrorsByRoom] = useState<Map<number, string>>(() => new Map());
  const [leaveErrorsByRoom, setLeaveErrorsByRoom] = useState<Map<number, string>>(() => new Map());
  const roomSessionRevision = useMeshcoreRoomSessionRevision();
  const [rememberPassword, setRememberPassword] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState(60);
  const [autoLoginOnConnect, setAutoLoginOnConnect] = useState(false);
  const [syncConfigDirty, setSyncConfigDirty] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  const [unreadDividerTimestamp, setUnreadDividerTimestamp] = useState(0);
  const [triggerScrollToUnread, setTriggerScrollToUnread] = useState(0);
  const [, setAutoLoginFailureEpoch] = useState(0);
  const [storedRoomIds, setStoredRoomIds] = useState<Set<number>>(
    () => new Set(listMeshcoreRoomCredentialNodeIds()),
  );
  const [savedPasswordsOpen, setSavedPasswordsOpen] = useState(false);
  const [forgetConfirmNodeId, setForgetConfirmNodeId] = useState<number | null>(null);
  const loginAttemptGenRef = useRef<Map<number, number>>(new Map());
  const leaveAttemptGenRef = useRef<Map<number, number>>(new Map());
  const consumedInitialRoomRef = useRef<number | null>(null);
  const loginQueueRevision = useMeshcoreRoomLoginQueueRevision();
  const streamRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Sticky intent: user is reading latest posts and wants auto-follow on new traffic. */
  const isPinnedToBottomRef = useRef(true);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedWasPinnedToBottomRef = useRef(false);
  /** Distinguishes a tab return (isActive false→true) from a view switch while already active. */
  const wasActiveRef = useRef(isActive);
  const unreadDividerRef = useRef<HTMLDivElement>(null);
  const [persistedRoomsLastRead, setPersistedRoomsLastRead] = useState(() =>
    loadPersistedRoomsLastRead(),
  );
  const persistedRoomsLastReadRef = useRef(persistedRoomsLastRead);
  useEffect(() => {
    persistedRoomsLastReadRef.current = persistedRoomsLastRead;
  }, [persistedRoomsLastRead]);
  const [streamView, setStreamView] = useState<'posts' | 'starred'>('posts');
  const [starred, setStarred] = useState<StarredMessage[]>(() => loadStarred('meshcore'));
  const layoutMode = useConversationLayoutMode();
  /** Phones: the room list and the open room take turns filling the panel. */
  const [compactPane, setCompactPane] = useState<'list' | 'conversation'>(() =>
    initialRoomTarget != null ? 'conversation' : 'list',
  );
  const [detailsPinned, setDetailsPinned] = useState(readDetailsPinned);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [aclEntries, setAclEntries] = useState<MeshcoreRoomAclEntry[]>([]);
  const [aclLoading, setAclLoading] = useState(false);
  const [aclError, setAclError] = useState<string | null>(null);
  const [aclFetchedAt, setAclFetchedAt] = useState<number | null>(null);
  const [scrollToRowKey, setScrollToRowKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [jumpDate, setJumpDate] = useState('');
  const [filterSender, setFilterSender] = useState<number | null>(null);
  const [mutedViews, setMutedViews] = useState<Set<string>>(() => loadMutedViews('meshcore'));
  const [roomListCollapsed, setRoomListCollapsed] = useState(
    () => localStorage.getItem(ROOMS_LIST_COLLAPSED_STORAGE_KEY) === 'true',
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Set alongside an explicit row-key jump so the room-switch effect skips its
   * own unread/end auto-scroll for that transition instead of racing it. */
  const suppressNextRoomSwitchScrollRef = useRef(false);

  const attachUnreadDividerRef = useCallback((node: HTMLDivElement | null) => {
    unreadDividerRef.current = node;
  }, []);

  const ownNodeIdSet = useMemo(
    () => (myNodeNum > 0 ? new Set([myNodeNum]) : new Set<number>()),
    [myNodeNum],
  );

  const refreshStoredRooms = useCallback(() => {
    setStoredRoomIds(new Set(listMeshcoreRoomCredentialNodeIds()));
  }, []);

  const savedCredentialNodeIds = useMemo(
    () => [...storedRoomIds].sort((a, b) => a - b),
    [storedRoomIds],
  );

  const resolveRoomDisplayName = useCallback(
    (nodeId: number): string => {
      const node = nodes.get(nodeId);
      if (node?.long_name) return node.long_name;
      return t('roomsPanel.savedPasswordOrphanLabel', {
        nodeId: nodeId.toString(16).padStart(8, '0'),
      });
    },
    [nodes, t],
  );

  useEffect(() => {
    return subscribeMeshcoreRoomAutoLoginFailureChanges(() => {
      setAutoLoginFailureEpoch((n) => n + 1);
    });
  }, []);

  const scrollToTop = useCallback(() => {
    streamRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useImperativeHandle(scrollToTopRef, () => scrollToTop, [scrollToTop]);

  const roomServers = useMemo(
    () =>
      Array.from(nodes.values())
        .filter((n) => n.hw_model === 'Room')
        .sort((a, b) => {
          const aFav = a.favorited ? 1 : 0;
          const bFav = b.favorited ? 1 : 0;
          if (aFav !== bFav) return bFav - aFav;
          return (a.long_name ?? '').localeCompare(b.long_name ?? '');
        }),
    [nodes],
  );

  const activeRoom = selectedRoomId != null ? nodes.get(selectedRoomId) : undefined;

  const roomPosts = useMemo(() => {
    if (selectedRoomId == null) return [];
    const posts = messages
      .filter((m) => m.roomServerId === selectedRoomId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const nameByNodeId = new Map<number, string>();
    for (const [id, node] of nodes) {
      const name = node.long_name?.trim();
      if (name) nameByNodeId.set(id, name);
    }
    return repairMeshcoreRoomUnknownSenderNames(
      repairMeshcoreHydrationStaleRoomSends(mergeDisplayedRoomPostChunks(posts)),
      nameByNodeId,
    );
  }, [messages, nodes, selectedRoomId]);

  const filteredRoomPosts = useMemo(() => {
    let posts = roomPosts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      posts = posts.filter(
        (m) => m.payload.toLowerCase().includes(q) || m.sender_name.toLowerCase().includes(q),
      );
    }
    if (filterSender != null) {
      posts = posts.filter((m) => m.sender_id === filterSender);
    }
    return posts;
  }, [filterSender, roomPosts, searchQuery]);

  const daySeparatorIndices = useMemo(() => {
    const indices = new Set<number>();
    let prevDayKey = '';
    for (let i = 0; i < filteredRoomPosts.length; i++) {
      const dayKey = getChatDayKey(filteredRoomPosts[i].timestamp);
      if (dayKey !== prevDayKey) {
        indices.add(i);
        prevDayKey = dayKey;
      }
    }
    return indices;
  }, [filteredRoomPosts]);

  const unreadStartIndex = useMemo(() => {
    if (searchQuery.trim() || unreadDividerTimestamp === 0) return -1;
    for (let i = 0; i < filteredRoomPosts.length; i++) {
      if (filteredRoomPosts[i].timestamp > unreadDividerTimestamp) return i;
    }
    return -1;
  }, [filteredRoomPosts, searchQuery, unreadDividerTimestamp]);

  const unreadStartIndexRef = useRef(unreadStartIndex);
  unreadStartIndexRef.current = unreadStartIndex;

  const estimatePostSize = useCallback(
    (index: number) => {
      const post = filteredRoomPosts[index];
      return estimateChatRowHeight(post, {
        unreadDividerExtra:
          index === unreadStartIndex ? CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX : undefined,
      });
    },
    [filteredRoomPosts, unreadStartIndex],
  );

  const measurePostElement = useMemo(
    () => createStableChatMeasureElement(estimatePostSize),
    [estimatePostSize],
  );

  const postVirtualizer = useVirtualizer({
    count: filteredRoomPosts.length,
    getScrollElement: () => streamRef.current,
    estimateSize: estimatePostSize,
    measureElement: measurePostElement,
    overscan: 10,
    getItemKey: (index) => {
      const post = filteredRoomPosts[index];
      if (!post) return `room-slot-${index}`;
      return roomPostVirtualizerKey(post, index);
    },
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: CHAT_SCROLL_END_THRESHOLD,
  });

  postVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = createChatScrollAdjustPredicate({
    unreadStartIndexRef,
    isPinnedToBottomRef,
  });

  const postVirtualizerRef = useRef(postVirtualizer);
  postVirtualizerRef.current = postVirtualizer;

  const schedulePostRowRemeasure = useCallback((rowIndex: number) => {
    scheduleVirtualRowRemeasure(
      (node) => {
        postVirtualizerRef.current.measureElement(node);
      },
      streamRef.current,
      rowIndex,
    );
  }, []);

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

  const roomUnreadCounts = useMemo(() => {
    const knownRoomServerIds = new Set(roomServers.map((r) => r.node_id));
    return computeRoomUnreadCounts(
      messages,
      persistedRoomsLastRead,
      ownNodeIdSet,
      mutedViews,
      knownRoomServerIds,
    );
  }, [messages, mutedViews, ownNodeIdSet, persistedRoomsLastRead, roomServers]);

  const markSelectedRoomRead = useCallback(() => {
    if (selectedRoomId == null || roomPosts.length === 0) return;
    const nowMs = Date.now();
    const latest = clampReadWatermarkMs(
      Math.max(...roomPosts.map((m) => effectiveMessageTimestampMs(m.timestamp, nowMs))),
      nowMs,
    );
    setPersistedRoomsLastRead((prev) => mergeRoomLastReadWatermark(prev, selectedRoomId, latest));
  }, [roomPosts, selectedRoomId]);

  useEffect(() => {
    try {
      savePersistedRoomsLastRead(persistedRoomsLastRead);
      notifyPersistedRoomsLastReadChanged();
    } catch (e) {
      console.warn('[RoomsPanel] persist rooms lastRead failed ' + errLikeToLogString(e));
    }
  }, [persistedRoomsLastRead]);

  const computeIsAtChatEnd = useCallback(() => {
    const inner = streamRef.current;
    if (!inner) return false;
    const virtualAtEnd = postVirtualizerRef.current.isAtEnd(CHAT_SCROLL_END_THRESHOLD);
    const outerDist = getDistFromChatBottom(
      inner,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (outerDist != null && outerDist > CHAT_SCROLL_END_THRESHOLD) return false;
    return virtualAtEnd;
  }, [outerScrollMetricsRootRef]);

  const updateScrollButtonVisibility = useCallback(() => {
    const atEnd = computeIsAtChatEnd();
    isPinnedToBottomRef.current = atEnd;
    setShowScrollButton(!atEnd);
    const scrollTop = streamRef.current?.scrollTop ?? 0;
    setShowScrollTopButton(scrollTop > 200);
    const distFromBottom = getDistFromChatBottom(
      streamRef.current,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (distFromBottom == null) return undefined;
    return distFromBottom;
  }, [computeIsAtChatEnd, outerScrollMetricsRootRef]);

  const applyNearBottomReadState = useCallback(
    (distFromBottom: number) => {
      if (!isActive || appWindowInactive) return;
      if (distFromBottom < 50) {
        markSelectedRoomRead();
        setUnreadDividerTimestamp(0);
      }
    },
    [appWindowInactive, isActive, markSelectedRoomRead],
  );

  const handleStreamScroll = useCallback(() => {
    if (unreadStartIndex >= 0 && unreadDividerRef.current && streamRef.current) {
      const container = streamRef.current;
      const divider = unreadDividerRef.current;
      const containerRect = container.getBoundingClientRect();
      const dividerRect = divider.getBoundingClientRect();
      if (dividerRect.bottom < containerRect.top) {
        setUnreadDividerTimestamp(0);
      }
    }
    const distFromBottom = updateScrollButtonVisibility();
    if (distFromBottom === undefined) return;
    applyNearBottomReadState(distFromBottom);
  }, [applyNearBottomReadState, unreadStartIndex, updateScrollButtonVisibility]);

  const scrollToBottom = useCallback(() => {
    postVirtualizerRef.current.scrollToEnd({ behavior: 'smooth' });
    isPinnedToBottomRef.current = true;
  }, []);

  const scrollToUnreadOrBottom = useCallback(() => {
    const el = streamRef.current;
    if (unreadStartIndex >= 0) {
      isPinnedToBottomRef.current = false;
      if (el) {
        const onEnd = () => {
          el.removeEventListener('scrollend', onEnd);
          const dist = getDistFromChatBottom(
            el,
            messagesEndRef.current,
            outerScrollMetricsRootRef?.current ?? null,
          );
          if (dist !== null) applyNearBottomReadState(dist);
        };
        el.addEventListener('scrollend', onEnd, { once: true });
      }
      postVirtualizerRef.current.scrollToIndex(unreadStartIndex, {
        align: 'start',
        behavior: 'smooth',
      });
    } else {
      scrollToBottom();
    }
  }, [applyNearBottomReadState, outerScrollMetricsRootRef, scrollToBottom, unreadStartIndex]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [updateScrollButtonVisibility]);

  useEffect(() => {
    if (!isActive || appWindowInactive || selectedRoomId == null) return;
    // An explicit row-key jump (Starred → Go to message) or its room-switch guard
    // owns scroll for this transition — skip pinned-bottom follow so we do not race
    // scrollToEnd ahead of scrollToRowKey (effect order: this runs before both).
    if (scrollToRowKey != null || suppressNextRoomSwitchScrollRef.current) return;
    if (isPinnedToBottomRef.current) {
      scrollToBottom();
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      if (dist !== undefined) applyNearBottomReadState(dist);
    });
  }, [
    applyNearBottomReadState,
    appWindowInactive,
    isActive,
    roomPosts.length,
    scrollToBottom,
    scrollToRowKey,
    selectedRoomId,
    updateScrollButtonVisibility,
  ]);

  useEffect(() => {
    if (!isActive) return;
    const root = outerScrollMetricsRootRef?.current;
    if (!root) return;
    const onOuterScroll = () => {
      const dist = updateScrollButtonVisibility();
      if (dist !== undefined) applyNearBottomReadState(dist);
    };
    root.addEventListener('scroll', onOuterScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onOuterScroll);
    };
  }, [applyNearBottomReadState, isActive, outerScrollMetricsRootRef, updateScrollButtonVisibility]);

  useEffect(() => {
    if (!isActive) return;
    const root = outerScrollMetricsRootRef?.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateScrollButtonVisibility();
      });
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
    };
  }, [isActive, outerScrollMetricsRootRef, updateScrollButtonVisibility]);

  // Owns all tab/view-switch scrolling. Distinguishes a tab return (isActive
  // false→true) from a genuine view switch while already active (room change
  // bumps triggerScrollToUnread): a tab return restores the position/pin-state
  // snapshotted on exit; a view switch scrolls to the unread divider or end.
  // These used to be two separate effects that both reacted to `isActive`, so
  // a tab return fired the view-switch scroll too and the restore immediately
  // clobbered it — visible as a jump (raw scrollTop restore painted one frame,
  // then the live-append effect below smooth-scrolled to the true end).
  useLayoutEffect(() => {
    const el = streamRef.current;
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    if (!isActive) {
      if (el) {
        savedScrollTopRef.current = el.scrollTop;
        savedWasPinnedToBottomRef.current = isPinnedToBottomRef.current;
      }
      return;
    }

    if (!wasActive) {
      if (savedScrollTopRef.current !== null) {
        if (savedWasPinnedToBottomRef.current) {
          postVirtualizerRef.current.scrollToEnd();
          isPinnedToBottomRef.current = true;
        } else if (el) {
          el.scrollTop = savedScrollTopRef.current;
        }
        savedScrollTopRef.current = null;
        savedWasPinnedToBottomRef.current = false;
      }
      return;
    }

    if (triggerScrollToUnread === 0) return;
    if (suppressNextRoomSwitchScrollRef.current || scrollToRowKey != null) return;
    if (unreadStartIndex >= 0) {
      postVirtualizerRef.current.scrollToIndex(unreadStartIndex, { align: 'center' });
      isPinnedToBottomRef.current = false;
    } else {
      postVirtualizerRef.current.scrollToEnd();
      isPinnedToBottomRef.current = true;
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      if (dist !== undefined && dist < 50) applyNearBottomReadState(dist);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- triggerScrollToUnread is the sole scroll intent
  }, [triggerScrollToUnread, isActive, scrollToRowKey]);

  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [isActive, selectedRoomId, updateScrollButtonVisibility]);

  useEffect(() => {
    if (selectedRoomId == null) return;
    // Read-watermark updates are not navigation and must not restart the scroll-to-unread flow.
    const snapshot = persistedRoomsLastReadRef.current[selectedRoomId] ?? 0;
    setUnreadDividerTimestamp(snapshot);
    if (suppressNextRoomSwitchScrollRef.current) {
      // An explicit row-key jump (e.g. "Go to message" from Starred) selected this
      // room and owns the scroll for this transition — skip the auto unread/end
      // scroll. suppressNextRoomSwitchScrollRef clears in the scrollToRowKey effect
      // after scrollToIndex so pinned-bottom follow cannot race ahead of it.
      return;
    }
    setTriggerScrollToUnread((n) => n + 1);
  }, [selectedRoomId]);

  const loadSyncConfig = useCallback((nodeId: number) => {
    const config = getMeshcoreRoomSyncConfig(nodeId);
    setSyncEnabled(config.enabled);
    setSyncInterval(config.intervalMinutes);
    setAutoLoginOnConnect(config.autoLoginOnConnect ?? false);
    setSyncConfigDirty(false);
  }, []);

  const handleStopAutoLogin = useCallback(
    async (nodeId: number) => {
      await disableMeshcoreRoomAutoLogin(nodeId);
      if (selectedRoomId === nodeId) {
        setAutoLoginOnConnect(false);
        setSyncConfigDirty(false);
      }
      refreshStoredRooms();
    },
    [refreshStoredRooms, selectedRoomId],
  );

  const handleConfirmForgetSavedPassword = useCallback(async () => {
    if (forgetConfirmNodeId == null) return;
    const nodeId = forgetConfirmNodeId;
    setForgetConfirmNodeId(null);
    await forgetMeshcoreRoomSavedSecrets(nodeId);
    refreshStoredRooms();
    if (selectedRoomId === nodeId) {
      loadSyncConfig(nodeId);
      setRememberPassword(false);
    }
  }, [forgetConfirmNodeId, loadSyncConfig, refreshStoredRooms, selectedRoomId]);

  const handleAutoLoginOnConnectChange = useCallback(
    async (nodeId: number, enabled: boolean) => {
      setAutoLoginOnConnect(enabled);
      const prev = getMeshcoreRoomSyncConfig(nodeId);
      try {
        if (!enabled) {
          await disableMeshcoreRoomAutoLogin(nodeId);
        } else {
          await setMeshcoreRoomSyncConfig(nodeId, {
            enabled: prev.enabled,
            intervalMinutes: prev.intervalMinutes,
            autoLoginOnConnect: true,
          });
          clearMeshcoreRoomAutoLoginFailure(nodeId);
        }
        if (selectedRoomIdRef.current === nodeId) setSyncConfigDirty(false);
      } catch (e: unknown) {
        console.warn('[RoomsPanel] save auto-login failed ' + errLikeToLogString(e));
        if (selectedRoomIdRef.current === nodeId) {
          setAutoLoginOnConnect(getMeshcoreRoomSyncConfig(nodeId).autoLoginOnConnect ?? false);
        }
        addToast(t('roomsPanel.autoLoginSaveFailed'), 'error');
      }
      refreshStoredRooms();
    },
    [addToast, refreshStoredRooms, t],
  );

  const handleSelectRoom = useCallback(
    (nodeId: number) => {
      setSelectedRoomId(nodeId);
      setCompactPane('conversation');
      setAclEntries([]);
      setAclError(null);
      setAclFetchedAt(null);
      setLoginErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      setLeaveErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      setLoginPassword('');
      setRememberPassword(false);
      loadSyncConfig(nodeId);
    },
    [loadSyncConfig],
  );

  useEffect(() => {
    if (initialRoomTarget == null) {
      consumedInitialRoomRef.current = null;
      return;
    }
    if (consumedInitialRoomRef.current === initialRoomTarget) return;
    consumedInitialRoomRef.current = initialRoomTarget;
    queueMicrotask(() => {
      handleSelectRoom(initialRoomTarget);
      onInitialRoomConsumed?.();
    });
  }, [initialRoomTarget, onInitialRoomConsumed, handleSelectRoom]);

  const loginQueueSnapshot = useMemo(() => {
    touch(loginQueueRevision);
    return getMeshcoreRoomLoginQueueSnapshot();
  }, [loginQueueRevision]);
  const loginQueueCount = meshcoreRoomLoginQueueSize();
  const activeLoginRoomId = loginQueueSnapshot.activeNodeId;
  const pendingLoginRoomIds = loginQueueSnapshot.pendingNodeIds;

  const startRoomLogin = useCallback(
    (nodeId: number, loginFn: () => Promise<void>) => {
      clearMeshcoreRoomAutoLoginFailure(nodeId);
      const gen = (loginAttemptGenRef.current.get(nodeId) ?? 0) + 1;
      loginAttemptGenRef.current.set(nodeId, gen);
      setLoginErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      setLocalLoginRoomIds((prev) => new Set(prev).add(nodeId));
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
          setLocalLoginRoomIds((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        });
    },
    [refreshStoredRooms, t],
  );

  const isRoomLoginInProgress = useCallback(
    (nodeId: number): boolean => {
      touch(loginQueueRevision);
      return meshcoreIsRoomLoginQueued(nodeId) || localLoginRoomIds.has(nodeId);
    },
    [localLoginRoomIds, loginQueueRevision],
  );

  const handleCancelLogin = useCallback(() => {
    if (loginQueueCount + localLoginRoomIds.size > 1) {
      meshcoreCancelAllRoomLogins();
      for (const nodeId of [activeLoginRoomId, ...pendingLoginRoomIds, ...localLoginRoomIds]) {
        if (nodeId == null) continue;
        loginAttemptGenRef.current.set(nodeId, (loginAttemptGenRef.current.get(nodeId) ?? 0) + 1);
      }
      setLocalLoginRoomIds(new Set());
      return;
    }
    const nodeId = activeLoginRoomId ?? selectedRoomId;
    if (nodeId == null) return;
    onCancelRoomLogin(nodeId);
    loginAttemptGenRef.current.set(nodeId, (loginAttemptGenRef.current.get(nodeId) ?? 0) + 1);
    setLocalLoginRoomIds((prev) => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, [
    activeLoginRoomId,
    localLoginRoomIds,
    loginQueueCount,
    onCancelRoomLogin,
    pendingLoginRoomIds,
    selectedRoomId,
  ]);

  const handleLoginAllSaved = useCallback(() => {
    if (!onLoginAllSaved) return;
    const targets = roomServers
      .filter((r) => storedRoomIds.has(r.node_id) && !meshcoreIsRoomLoggedIn(r.node_id))
      .map((r) => r.node_id);
    if (targets.length === 0) return;
    for (const nodeId of targets) {
      loginAttemptGenRef.current.set(nodeId, (loginAttemptGenRef.current.get(nodeId) ?? 0) + 1);
      setLocalLoginRoomIds((prev) => new Set(prev).add(nodeId));
    }
    void onLoginAllSaved(targets)
      .catch((e: unknown) => {
        console.warn('[RoomsPanel] loginAllSaved failed ' + errLikeToLogString(e));
      })
      .finally(() => {
        setLocalLoginRoomIds(new Set());
      });
  }, [onLoginAllSaved, roomServers, storedRoomIds]);

  const handleLogin = useCallback(() => {
    if (selectedRoomId == null) return;
    const nodeId = selectedRoomId;
    const password = meshcoreRoomEffectiveGuestPassword(loginPassword);
    const forceRelogin = meshcoreGetRoomSession(nodeId)?.role === 'readonly';
    startRoomLogin(nodeId, async () => {
      await onLoginRoom(nodeId, password, {
        guestPassword: password,
        adminPassword: '',
        rememberPassword,
        forceRelogin,
      });
      if (rememberPassword) refreshStoredRooms();
      setLoginPassword('');
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
    if (autoLoginOnConnect && !storedRoomIds.has(selectedRoomId)) {
      const session = meshcoreGetRoomSession(selectedRoomId);
      if (session) {
        await setMeshcoreRoomCredential(selectedRoomId, {
          guestPassword: session.guestPassword,
          ...(session.adminPassword.length > 0 ? { adminPassword: session.adminPassword } : {}),
        });
        refreshStoredRooms();
      }
    }
    await setMeshcoreRoomSyncConfig(selectedRoomId, {
      enabled: syncEnabled,
      intervalMinutes: syncInterval,
      autoLoginOnConnect,
    });
    setSyncConfigDirty(false);
  }, [
    autoLoginOnConnect,
    refreshStoredRooms,
    selectedRoomId,
    storedRoomIds,
    syncEnabled,
    syncInterval,
  ]);

  const roomViewKey = selectedRoomId != null ? `room:${selectedRoomId}` : 'room:none';

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, []);

  const toggleSearch = useCallback(() => {
    setShowSearch((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  }, []);

  const toggleMuteView = useCallback((viewKey: string) => {
    setMutedViews((prev) => {
      const next = new Set(prev);
      if (next.has(viewKey)) next.delete(viewKey);
      else next.add(viewKey);
      return next;
    });
  }, []);

  const handleRoomListToggle = useCallback(() => {
    setRoomListCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(ROOMS_LIST_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const handleJumpToDate = useCallback(
    (dateStr: string) => {
      if (!dateStr) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      const targetKey = `${y}-${m}-${d}`;
      const index = findFirstMessageIndexByDayKey(filteredRoomPosts, targetKey);
      if (index < 0) return;
      isPinnedToBottomRef.current = false;
      postVirtualizerRef.current.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      setShowDatePicker(false);
    },
    [filteredRoomPosts],
  );

  useEffect(() => {
    saveMutedViews('meshcore', mutedViews);
  }, [mutedViews]);

  useEffect(() => {
    setShowSearch(false);
    setSearchQuery('');
    setShowDatePicker(false);
    setJumpDate('');
    setFilterSender(null);
  }, [selectedRoomId]);

  useEffect(() => {
    if (streamView === 'starred') {
      closeSearch();
    }
  }, [closeSearch, streamView]);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (filterSender != null) {
        setFilterSender(null);
        return;
      }
      if (showDatePicker) {
        setShowDatePicker(false);
        return;
      }
      if (showSearch) {
        closeSearch();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeSearch, filterSender, showDatePicker, showSearch]);

  const starredIdSet = useMemo(() => new Set(starred.map((s) => s.starId)), [starred]);
  const roomStarred = useMemo(
    () =>
      starred
        .filter((s) => s.viewKey.startsWith('room:'))
        .sort((a, b) => b.starredAt - a.starredAt),
    [starred],
  );
  const recognizedPosters = useMemo(
    () => buildRecognizedPosters(roomPosts, nodes, t('common.unknown')),
    [nodes, roomPosts, t],
  );
  const canAdminRoom = selectedRoomId != null && meshcoreRoomCanAdmin(selectedRoomId);

  useEffect(() => {
    saveStarred('meshcore', starred);
  }, [starred]);

  useEffect(() => {
    if (streamView !== 'posts' || !scrollToRowKey) return;
    const index = findIndexByRowKey(roomPosts, scrollToRowKey, roomPostRowKey);
    if (index >= 0) {
      isPinnedToBottomRef.current = false;
      postVirtualizerRef.current.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
    }
    setScrollToRowKey(null);
    requestAnimationFrame(() => {
      suppressNextRoomSwitchScrollRef.current = false;
    });
  }, [scrollToRowKey, streamView, roomPosts]);

  const toggleStar = useCallback(
    (msg: ChatMessage) => {
      const starId = roomMsgStarId(msg);
      setStarred((prev) => {
        if (prev.some((s) => s.starId === starId)) {
          return prev.filter((s) => s.starId !== starId);
        }
        const entry: StarredMessage = {
          starId,
          timestamp: msg.timestamp,
          payload: msg.payload,
          sender_name: msg.sender_name ?? '',
          sender_id: msg.sender_id,
          viewKey: roomViewKey,
          channel: msg.channel,
          to: msg.to ?? null,
          starredAt: Date.now(),
        };
        return [...prev, entry];
      });
    },
    [roomViewKey],
  );

  const handleRefreshAcl = useCallback(async () => {
    if (selectedRoomId == null || !canAdminRoom) return;
    setAclLoading(true);
    setAclError(null);
    try {
      const response = await onSendRoomAdminCli(selectedRoomId, 'get acl');
      const parsed = parseMeshcoreRoomAclResponse(response);
      setAclEntries(parsed);
      setAclFetchedAt(Date.now());
    } catch (e: unknown) {
      console.warn('[RoomsPanel] fetch ACL failed ' + errLikeToLogString(e));
      setAclError(e instanceof Error ? e.message : t('roomsPanel.membersAclFetchFailed'));
      setAclEntries([]);
    } finally {
      setAclLoading(false);
    }
  }, [canAdminRoom, onSendRoomAdminCli, selectedRoomId, t]);

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

  const startRoomLeave = useCallback(
    (nodeId: number, leaveFn: () => Promise<void>) => {
      const gen = (leaveAttemptGenRef.current.get(nodeId) ?? 0) + 1;
      leaveAttemptGenRef.current.set(nodeId, gen);
      setLeaveLoadingRoomIds((prev) => new Set(prev).add(nodeId));
      setLeaveErrorsByRoom((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      void leaveFn()
        .then(() => {
          if (leaveAttemptGenRef.current.get(nodeId) !== gen) return;
          setLoginErrorsByRoom((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
        })
        .catch((e: unknown) => {
          if (leaveAttemptGenRef.current.get(nodeId) !== gen) return;
          setLeaveErrorsByRoom((prev) =>
            new Map(prev).set(
              nodeId,
              e instanceof Error ? e.message : t('roomsPanel.leaveRoomFailed'),
            ),
          );
        })
        .finally(() => {
          if (leaveAttemptGenRef.current.get(nodeId) !== gen) return;
          setLeaveLoadingRoomIds((prev) => {
            if (!prev.has(nodeId)) return prev;
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        });
    },
    [t],
  );

  const handleLeaveRoom = useCallback(() => {
    if (selectedRoomId == null || !isConnected) return;
    startRoomLeave(selectedRoomId, () => onLeaveRoom(selectedRoomId));
  }, [isConnected, onLeaveRoom, selectedRoomId, startRoomLeave]);

  const handleOpenRepeaterOps = useCallback(() => {
    if (selectedRoomId == null || !onOpenRepeaterOps) return;
    onOpenRepeaterOps(selectedRoomId);
  }, [onOpenRepeaterOps, selectedRoomId]);

  const loggedIn = useMemo(() => {
    touch(roomSessionRevision);
    return selectedRoomId != null && meshcoreIsRoomLoggedIn(selectedRoomId);
  }, [selectedRoomId, roomSessionRevision]);
  const guestFieldEmpty = loginPassword.trim().length === 0;
  const selectedRoomLoginLoading = selectedRoomId != null && isRoomLoginInProgress(selectedRoomId);
  const loginAllInProgress = localLoginRoomIds.size > 1 || loginQueueCount > 1;
  const otherRoomLoginInProgress =
    loginQueueCount + localLoginRoomIds.size > 0 &&
    selectedRoomId != null &&
    !isRoomLoginInProgress(selectedRoomId);
  const activeLoginRoomName =
    activeLoginRoomId != null
      ? (nodes.get(activeLoginRoomId)?.long_name ?? String(activeLoginRoomId))
      : '';
  const savedRoomsNotLoggedInCount = useMemo(() => {
    touch(roomSessionRevision);
    return roomServers.filter(
      (r) => storedRoomIds.has(r.node_id) && !meshcoreIsRoomLoggedIn(r.node_id),
    ).length;
  }, [roomServers, roomSessionRevision, storedRoomIds]);
  const savedRoomCount = useMemo(
    () => roomServers.filter((r) => storedRoomIds.has(r.node_id)).length,
    [roomServers, storedRoomIds],
  );
  const loginAllSavedDisabled = !isConnected || savedRoomsNotLoggedInCount === 0;
  const loginAllSavedDisabledReason = !isConnected
    ? t('roomsPanel.loginAllSavedDisabledNotConnected')
    : savedRoomCount === 0
      ? t('roomsPanel.loginAllSavedDisabledNoSavedPasswords')
      : savedRoomsNotLoggedInCount === 0
        ? t('roomsPanel.loginAllSavedDisabledAllLoggedIn')
        : '';
  /** Overlay Login may send a zero-byte password; upgrade needs a non-empty guest password. */
  const overlayLoginEnabled = isConnected && !selectedRoomLoginLoading;
  const upgradeLoginEnabled = overlayLoginEnabled && !guestFieldEmpty;
  const selectedRoomLeaveLoading =
    selectedRoomId != null && leaveLoadingRoomIds.has(selectedRoomId);
  const loginErrorRaw =
    selectedRoomId != null ? (loginErrorsByRoom.get(selectedRoomId) ?? null) : null;
  const loginError = loginErrorRaw != null ? translateMeshcoreUserMessage(t, loginErrorRaw) : null;
  const leaveErrorRaw =
    selectedRoomId != null ? (leaveErrorsByRoom.get(selectedRoomId) ?? null) : null;
  const leaveError = leaveErrorRaw != null ? translateMeshcoreUserMessage(t, leaveErrorRaw) : null;
  const autoLoginFailureRaw =
    selectedRoomId != null ? getMeshcoreRoomAutoLoginFailure(selectedRoomId) : null;
  const autoLoginFailureDisplay =
    autoLoginFailureRaw != null ? translateMeshcoreUserMessage(t, autoLoginFailureRaw) : null;
  const canPost = selectedRoomId != null && meshcoreRoomCanPost(selectedRoomId);
  const sessionRole = selectedRoomId != null ? meshcoreGetRoomSession(selectedRoomId)?.role : null;
  const selectedRoomSecretsSummary =
    selectedRoomId != null ? getMeshcoreRoomSavedSecretsSummary(selectedRoomId) : null;
  const showLoginSavedSecretsControls =
    selectedRoomId != null &&
    !loggedIn &&
    !selectedRoomLoginLoading &&
    (storedRoomIds.has(selectedRoomId) ||
      Boolean(getMeshcoreRoomAutoLoginFailure(selectedRoomId)) ||
      selectedRoomSecretsSummary?.autoLoginOnConnect);

  const detailsOpen = layoutMode.sideOverlay ? detailsSheetOpen : detailsPinned;
  const setDetailsOpen = (open: boolean) => {
    if (layoutMode.sideOverlay) {
      setDetailsSheetOpen(open);
      return;
    }
    setDetailsPinned(open);
    try {
      localStorage.setItem(ROOMS_DETAILS_COLLAPSED_STORAGE_KEY, String(!open));
    } catch {
      // catch-no-log-ok localStorage may be unavailable
    }
  };
  const roomIsMuted = mutedViews.has(roomViewKey);
  const moreActions: MenuEntry[] = [
    {
      id: 'jump-to-date',
      label: t('chatPanel.jumpToDate'),
      icon: <Calendar aria-hidden className="h-4 w-4" size={16} />,
      disabled: streamView !== 'posts',
      onSelect: () => {
        setShowDatePicker(true);
      },
    },
    {
      id: 'export',
      label: t('chatPanel.exportChat'),
      icon: <Download aria-hidden className="h-4 w-4" size={16} />,
      onSelect: () => {
        void (async () => {
          try {
            const msgs = filteredRoomPosts.map((m) => ({
              timestamp: m.timestamp,
              sender_name: m.sender_name,
              payload: m.payload,
              channel: m.channel,
              to: m.to,
            }));
            await window.electronAPI.chat.export(msgs);
          } catch (e: unknown) {
            console.warn('[RoomsPanel] export failed ' + errLikeToLogString(e));
          }
        })();
      },
    },
    ...(onOpenRepeaterOps
      ? [
          {
            id: 'manage',
            label: t('roomsPanel.manageRoom'),
            description: t('roomsPanel.manageJumpHint'),
            icon: <Wrench aria-hidden className="h-4 w-4" size={16} />,
            disabled: !isConnected || selectedRoomId == null,
            onSelect: handleOpenRepeaterOps,
          },
        ]
      : []),
  ];

  const roomRows = roomServers.map((room) => {
    const count = postCountByRoom.get(room.node_id) ?? 0;
    const selected = selectedRoomId === room.node_id;
    const unread = selected ? 0 : (roomUnreadCounts.get(room.node_id) ?? 0);
    const isLogged = meshcoreIsRoomLoggedIn(room.node_id);
    const hasSaved = storedRoomIds.has(room.node_id);
    const isLoggingIn = isRoomLoginInProgress(room.node_id) && !isLogged;
    const isLeaving = leaveLoadingRoomIds.has(room.node_id);
    const autoLoginFailed = getMeshcoreRoomAutoLoginFailure(room.node_id);
    const autoLoginFailedDisplay =
      autoLoginFailed != null ? translateMeshcoreUserMessage(t, autoLoginFailed) : '';
    const showAutoLoginFailed = Boolean(autoLoginFailed) && !isLogged && !isLoggingIn && !isLeaving;
    const marker = resolveMeshcoreRoomSidebarMarker({
      isLoggedIn: isLogged,
      hasSavedPassword: hasSaved,
      isLeaving,
    });
    const markerTitle = isLogged
      ? t('roomsPanel.legendLoggedIn')
      : isLeaving
        ? t('roomsPanel.leaveRoomInProgress')
        : showAutoLoginFailed
          ? t('roomsPanel.autoLoginFailed', { error: autoLoginFailedDisplay })
          : hasSaved
            ? t('roomsPanel.legendSaved')
            : t('roomsPanel.legendNotSaved');
    const unreadLabel = unread > 99 ? '99+' : unread;
    return (
      <li
        key={room.node_id}
        className={`border-ink-800/70 flex items-stretch border-b transition-colors ${
          selected ? 'bg-sidebar-active-bg' : 'hover:bg-secondary-dark/40'
        }`}
      >
        <button
          type="button"
          data-unread={unread}
          aria-current={selected ? 'true' : undefined}
          onClick={() => {
            handleSelectRoom(room.node_id);
          }}
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pl-3 text-left"
        >
          <span className="text-body text-ink-200 flex min-w-0 items-center gap-2">
            {isLoggingIn ? (
              <span
                role="img"
                className={ROOM_LOGIN_PROGRESS_DOT}
                aria-label={t('roomsPanel.loggingInMarkerAria')}
                title={t('roomsPanel.loggingIn')}
              />
            ) : (
              <span
                title={markerTitle}
                className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                  showAutoLoginFailed ? 'ring-1 ring-red-500' : ''
                }`}
                {...(showAutoLoginFailed
                  ? {
                      role: 'img',
                      'aria-label': t('roomsPanel.autoLoginFailedAria', {
                        error: autoLoginFailedDisplay,
                      }),
                    }
                  : { 'aria-hidden': true })}
              >
                <StatusDot tone={marker.tone} pulse={marker.pulse} size="md" />
              </span>
            )}
            <span
              className={`min-w-0 flex-1 truncate ${selected ? 'text-bright-green font-medium' : ''}`}
            >
              {room.long_name}
            </span>
            {unread > 0 && (
              <span className="text-2xs flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-600 px-1 leading-none font-semibold text-white">
                {unreadLabel}
              </span>
            )}
          </span>
          <span className="text-muted pl-5.5 text-xs">
            {t('roomsPanel.postCount', { count })}
            {unread > 0 && (
              <>
                {' · '}
                {t('roomsPanel.unreadPosts', { count: unreadLabel })}
              </>
            )}
          </span>
        </button>
        {onToggleFavorite ? (
          <button
            type="button"
            onClick={() => {
              onToggleFavorite(room.node_id, !room.favorited);
            }}
            aria-pressed={Boolean(room.favorited)}
            aria-label={room.favorited ? t('roomsPanel.unfavorite') : t('roomsPanel.favorite')}
            title={room.favorited ? t('roomsPanel.unfavorite') : t('roomsPanel.favorite')}
            className={`flex w-10 shrink-0 items-center justify-center transition-colors ${
              room.favorited ? 'text-yellow-400' : 'text-muted hover:text-ink-200'
            }`}
          >
            <Star
              aria-hidden
              className={`h-3.5 w-3.5 ${room.favorited ? 'fill-current' : ''}`}
              size={14}
            />
          </button>
        ) : null}
      </li>
    );
  });

  const listColumn = (
    <>
      <div className="border-ink-800 flex min-h-14 shrink-0 items-center gap-2 border-b pr-2 pl-3">
        <h2 className="text-ink-100 min-w-0 flex-1 truncate text-sm font-semibold">
          {t('roomsPanel.title')}{' '}
          <span className="text-muted font-normal tabular-nums">({roomServers.length})</span>
        </h2>
        {onLoginAllSaved && roomServers.length > 0 ? (
          <Button
            size="sm"
            data-setting-anchor="rooms.list.loginAllSaved"
            onClick={handleLoginAllSaved}
            disabled={loginAllSavedDisabled}
            aria-label={t('roomsPanel.loginAllSavedAria')}
            title={
              loginAllSavedDisabled && loginAllSavedDisabledReason
                ? loginAllSavedDisabledReason
                : t('roomsPanel.loginAllSavedTooltip')
            }
          >
            {t('roomsPanel.loginAllSaved')}
          </Button>
        ) : null}
        {!layoutMode.compact && (
          <IconButton
            size="sm"
            aria-label={t('roomsPanel.collapseRoomList')}
            aria-expanded
            onClick={handleRoomListToggle}
            icon={<PanelLeftClose aria-hidden className="h-4 w-4" size={16} />}
          />
        )}
      </div>
      {roomServers.length > 0 && (
        <ul
          aria-label={t('roomsPanel.sidebarLegendTitle')}
          className="text-muted border-ink-800 flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b px-3 py-2 text-xs"
        >
          <li className="flex items-center gap-1.5">
            <StatusDot tone="ok" size="md" />
            {t('roomsPanel.legendLoggedIn')}
          </li>
          <li className="flex items-center gap-1.5">
            <StatusDot tone="info" size="md" />
            {t('roomsPanel.legendSaved')}
          </li>
          <li className="flex items-center gap-1.5">
            <StatusDot tone="idle" size="md" />
            {t('roomsPanel.legendNotSaved')}
          </li>
        </ul>
      )}
      {savedCredentialNodeIds.length > 0 && (
        <div className="border-ink-800 shrink-0 border-b">
          <h3 id="rooms-saved-passwords-heading" className="sr-only">
            {t('roomsPanel.savedPasswordsHeading')}
          </h3>
          <button
            type="button"
            onClick={() => {
              setSavedPasswordsOpen((open) => !open);
            }}
            className="hover:bg-secondary-dark/40 text-ink-300 flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium"
            aria-expanded={savedPasswordsOpen}
            aria-labelledby="rooms-saved-passwords-heading"
          >
            {savedPasswordsOpen ? (
              <ChevronDown aria-hidden className="text-muted h-3.5 w-3.5" size={14} />
            ) : (
              <ChevronRight aria-hidden className="text-muted h-3.5 w-3.5" size={14} />
            )}
            {t('roomsPanel.savedPasswordsCount', { count: savedCredentialNodeIds.length })}
          </button>
          {savedPasswordsOpen && (
            <ul className="border-ink-800/70 max-h-48 overflow-y-auto border-t">
              {savedCredentialNodeIds.map((nodeId) => {
                const summary = getMeshcoreRoomSavedSecretsSummary(nodeId);
                return (
                  <li
                    key={nodeId}
                    className="border-ink-800/70 space-y-1.5 border-b px-3 py-2 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectRoom(nodeId);
                      }}
                      className="hover:text-bright-green text-body text-ink-200 w-full truncate text-left"
                    >
                      {resolveRoomDisplayName(nodeId)}
                    </button>
                    {(summary.autoLoginOnConnect || summary.syncEnabled) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {summary.autoLoginOnConnect && (
                          <span className="bg-secondary-dark text-label text-ink-300 rounded-md px-1.5 py-0.5">
                            {t('roomsPanel.badgeAutoLogin')}
                          </span>
                        )}
                        {summary.syncEnabled && (
                          <span className="bg-secondary-dark text-label text-ink-300 rounded-md px-1.5 py-0.5">
                            {t('roomsPanel.badgeAutoSync')}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {summary.autoLoginOnConnect && (
                        <Button
                          size="sm"
                          onClick={() => {
                            void handleStopAutoLogin(nodeId);
                          }}
                          aria-label={t('roomsPanel.stopAutoLoginAria')}
                        >
                          {t('roomsPanel.stopAutoLogin')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setForgetConfirmNodeId(nodeId);
                        }}
                        aria-label={t('roomsPanel.forgetSavedPasswordAria')}
                      >
                        {t('roomsPanel.forgetSavedPassword')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {roomServers.length === 0 ? (
          <p className="text-muted px-3 py-4 text-sm">{t('roomsPanel.noRoomsYet')}</p>
        ) : (
          <ul aria-label={t('roomsPanel.title')}>{roomRows}</ul>
        )}
      </div>
    </>
  );

  const listToggle = layoutMode.compact ? (
    <IconButton
      aria-label={t('roomsPanel.backToList')}
      onClick={() => {
        setCompactPane('list');
      }}
      icon={<ChevronLeft aria-hidden className="h-4 w-4" size={16} />}
    />
  ) : roomListCollapsed ? (
    <IconButton
      aria-label={t('roomsPanel.expandRoomList')}
      aria-expanded={false}
      onClick={handleRoomListToggle}
      icon={<PanelLeftOpen aria-hidden className="h-4 w-4" size={16} />}
    />
  ) : null;

  const conversationHeader =
    selectedRoomId != null ? (
      <header className="border-ink-800 flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        {listToggle}
        <div className="min-w-0 flex-1">
          <h2 className="text-ink-100 truncate text-sm font-semibold">
            {activeRoom?.long_name ?? resolveRoomDisplayName(selectedRoomId)}
          </h2>
          {loggedIn && (
            <p className="text-muted flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
              <span
                className="inline-flex items-center gap-1.5"
                title={t('roomsPanel.statusLoggedInSessionTooltip')}
              >
                <StatusDot tone="ok" />
                {t('roomsPanel.statusLoggedInSession')}
              </span>
              {sessionRole === 'readonly' && (
                <span className="text-label rounded-md border border-orange-700/50 bg-orange-950/40 px-1.5 text-orange-200">
                  {t('roomsPanel.readOnlyBadge')}
                </span>
              )}
              <span>{t('roomsPanel.postCount', { count: roomPosts.length })}</span>
              {newestPostTs != null && (
                <span>
                  {t('roomsPanel.lastPost')}: {formatTimestamp(newestPostTs)}
                </span>
              )}
              {lastSyncAt != null && (
                <span>
                  {t('roomsPanel.lastSync')}: {formatTimestamp(lastSyncAt)}
                </span>
              )}
            </p>
          )}
        </div>
        {loggedIn && (
          <div className="flex items-center gap-0.5">
            <IconButton
              aria-label={t('chatPanel.searchMessages')}
              aria-pressed={showSearch}
              active={showSearch ? 'brand' : false}
              onClick={() => {
                toggleSearch();
              }}
              icon={<Search aria-hidden className="h-4 w-4" size={16} />}
            />
            <IconButton
              aria-label={t('chatPanel.starredMessages')}
              aria-pressed={streamView === 'starred'}
              active={streamView === 'starred' ? 'warn' : false}
              onClick={() => {
                setStreamView((v) => (v === 'starred' ? 'posts' : 'starred'));
              }}
              icon={
                <Star
                  aria-hidden
                  className={`h-4 w-4 ${streamView === 'starred' ? 'fill-current' : ''}`}
                  size={16}
                />
              }
            />
            {streamView === 'posts' && (
              <IconButton
                aria-label={
                  roomIsMuted ? t('chatPanel.unmuteConversation') : t('chatPanel.muteConversation')
                }
                aria-pressed={roomIsMuted}
                active={roomIsMuted ? 'warn' : false}
                onClick={() => {
                  toggleMuteView(roomViewKey);
                }}
                icon={
                  roomIsMuted ? (
                    <BellOff aria-hidden className="h-4 w-4" size={16} />
                  ) : (
                    <Bell aria-hidden className="h-4 w-4" size={16} />
                  )
                }
              />
            )}
            <IconButton
              aria-label={t('roomsPanel.details')}
              aria-pressed={detailsOpen}
              active={detailsOpen ? 'brand' : false}
              onClick={() => {
                setDetailsOpen(!detailsOpen);
              }}
              icon={<Info aria-hidden className="h-4 w-4" size={16} />}
            />
            <IconButton
              aria-label={
                selectedRoomLeaveLoading ? t('roomsPanel.leavingRoom') : t('roomsPanel.leaveRoom')
              }
              disabled={!isConnected || selectedRoomLeaveLoading}
              onClick={handleLeaveRoom}
              icon={<LogOut aria-hidden className="h-4 w-4" size={16} />}
            />
            <MenuButton
              aria-label={t('roomsPanel.moreActions')}
              menuLabel={t('roomsPanel.moreActions')}
              icon={<Ellipsis aria-hidden className="h-4 w-4" size={16} />}
              entries={moreActions}
            />
          </div>
        )}
      </header>
    ) : null;

  const loginCard = selectedRoomId != null && !loggedIn && !selectedRoomLoginLoading && (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-4 sm:items-center">
      <div className="bg-app-bg border-ink-800 h-fit w-full max-w-sm space-y-3 rounded-xl border p-4">
        <h3 className="text-ink-100 text-base font-semibold">{t('roomsPanel.loginTitle')}</h3>
        <p className="text-muted text-xs">{t('roomsPanel.loginHelp')}</p>
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
          className={INPUT_CLASS}
          aria-label={t('roomsPanel.guestPasswordLabel')}
        />
        <label className="text-ink-300 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={rememberPassword}
            onChange={(e) => {
              setRememberPassword(e.target.checked);
            }}
            disabled={!isConnected}
          />
          {t('roomsPanel.rememberPassword')}
        </label>
        {guestFieldEmpty && (
          <p className="text-xs text-orange-200">{t('roomsPanel.emptyGuestLoginHint')}</p>
        )}
        {showLoginSavedSecretsControls && selectedRoomSecretsSummary && (
          <div className={`${NOTICE_CLASS.info} space-y-2`}>
            {selectedRoomSecretsSummary.hasCredential && (
              <p className="flex items-center gap-1.5">
                <StatusDot tone="info" size="md" />
                {t('roomsPanel.statusPasswordSaved')}
              </p>
            )}
            {selectedRoomSecretsSummary.autoLoginOnConnect && (
              <p>{t('roomsPanel.statusAutoLoginEnabled')}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selectedRoomSecretsSummary.autoLoginOnConnect && (
                <Button
                  size="sm"
                  onClick={() => {
                    void handleStopAutoLogin(selectedRoomId);
                  }}
                  aria-label={t('roomsPanel.stopAutoLoginAria')}
                >
                  {t('roomsPanel.stopAutoLogin')}
                </Button>
              )}
              {selectedRoomSecretsSummary.hasCredential &&
                !selectedRoomSecretsSummary.autoLoginOnConnect && (
                  <Button
                    size="sm"
                    onClick={() => {
                      void handleAutoLoginOnConnectChange(selectedRoomId, true);
                    }}
                    aria-label={t('roomsPanel.enableAutoLoginAria')}
                  >
                    {t('roomsPanel.enableAutoLogin')}
                  </Button>
                )}
              {selectedRoomSecretsSummary.hasCredential && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setForgetConfirmNodeId(selectedRoomId);
                  }}
                  aria-label={t('roomsPanel.forgetSavedPasswordAria')}
                >
                  {t('roomsPanel.forgetSavedPassword')}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleLogin}
            disabled={!overlayLoginEnabled}
          >
            {t('roomsPanel.loginButton')}
          </Button>
          <Button className="w-full" onClick={handleReadOnlyLogin} disabled={!isConnected}>
            {t('roomsPanel.continueReadOnly')}
          </Button>
        </div>
        {loginError && <p className="text-sm text-red-400">{loginError}</p>}
        {autoLoginFailureDisplay && !loginError && (
          <p className="text-sm text-red-400" role="alert">
            {t('roomsPanel.autoLoginFailed', {
              error: autoLoginFailureDisplay,
            })}
          </p>
        )}
      </div>
    </div>
  );

  const detailsPanel =
    selectedRoomId != null && loggedIn ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-ink-800 flex min-h-14 shrink-0 items-center gap-2 border-b pr-2 pl-3">
          <h3 className="text-ink-100 min-w-0 flex-1 truncate text-sm font-semibold">
            {t('roomsPanel.details')}
          </h3>
          <IconButton
            size="sm"
            aria-label={t('roomsPanel.hideDetails')}
            onClick={() => {
              setDetailsOpen(false);
            }}
            icon={<X aria-hidden className="h-4 w-4" size={16} />}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
          <section aria-labelledby="rooms-details-sync-heading" className="space-y-3">
            <h4 id="rooms-details-sync-heading" className="text-ink-300 text-xs font-semibold">
              {t('roomsPanel.loginAndSyncHeading')}
            </h4>
            <div data-setting-anchor="rooms.sync.autoLogin">
              <Switch
                checked={autoLoginOnConnect}
                onChange={(checked) => {
                  void handleAutoLoginOnConnectChange(selectedRoomId, checked);
                }}
                disabled={
                  !storedRoomIds.has(selectedRoomId) && !meshcoreIsRoomLoggedIn(selectedRoomId)
                }
                label={t('roomsPanel.autoLoginOnConnect')}
                description={
                  !storedRoomIds.has(selectedRoomId) && !meshcoreIsRoomLoggedIn(selectedRoomId)
                    ? t('roomsPanel.autoLoginRequiresSavedPassword')
                    : t('roomsPanel.autoLoginOnConnectTooltip')
                }
              />
            </div>
            <div data-setting-anchor="rooms.sync.autoSync">
              <Switch
                checked={syncEnabled}
                onChange={(checked) => {
                  setSyncEnabled(checked);
                  setSyncConfigDirty(true);
                }}
                label={t('roomsPanel.autoSync')}
                description={t('roomsPanel.autoSyncTooltip')}
              />
            </div>
            {syncEnabled && (
              <label data-setting-anchor="rooms.sync.syncInterval" className="flex flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>{t('roomsPanel.syncIntervalLabel')}</span>
                <select
                  value={syncInterval}
                  onChange={(e) => {
                    setSyncInterval(Number.parseInt(e.target.value, 10));
                    setSyncConfigDirty(true);
                  }}
                  className={SELECT_CLASS}
                >
                  <option value={60}>{t('roomsPanel.syncInterval60')}</option>
                  <option value={120}>{t('roomsPanel.syncInterval120')}</option>
                  <option value={240}>{t('roomsPanel.syncInterval240')}</option>
                </select>
              </label>
            )}
            {syncConfigDirty && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void handleSaveSyncConfig();
                }}
              >
                {t('roomsPanel.saveSyncConfig')}
              </Button>
            )}
            <p className="text-muted text-xs">{t('roomsPanel.historyLocalHint')}</p>
            {storedRoomIds.has(selectedRoomId) && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setForgetConfirmNodeId(selectedRoomId);
                }}
                aria-label={t('roomsPanel.forgetSavedPasswordAria')}
              >
                {t('roomsPanel.forgetSavedPassword')}
              </Button>
            )}
          </section>

          <section aria-labelledby="rooms-details-members-heading" className="space-y-3">
            <h4 id="rooms-details-members-heading" className="text-ink-300 text-xs font-semibold">
              {recognizedPosters.length > 0
                ? t('roomsPanel.membersHeadingWithCount', { count: recognizedPosters.length })
                : t('roomsPanel.membersHeading')}
            </h4>
            <div className="space-y-1">
              <p className={FIELD_LABEL_CLASS}>{t('roomsPanel.membersRecognizedHeading')}</p>
              {recognizedPosters.length === 0 ? (
                <p className="text-muted text-xs">{t('roomsPanel.membersRecognizedEmpty')}</p>
              ) : (
                <ul className="space-y-0.5">
                  {recognizedPosters.map((p) => (
                    <li
                      key={p.senderId}
                      className="hover:bg-secondary-dark/40 flex min-h-8 items-center gap-2 rounded-lg px-2"
                    >
                      <span className="text-body text-ink-200 min-w-0 flex-1 truncate">
                        {p.senderName}
                      </span>
                      <span className="text-muted text-label shrink-0 font-mono tabular-nums">
                        {formatTimestamp(p.lastPostAt)}
                      </span>
                      {onMessageNode && canDmMeshcorePoster(p.senderId, myNodeNum, nodes) && (
                        <IconButton
                          size="sm"
                          aria-label={t('nodeDetailModal.messageButton')}
                          onClick={() => {
                            onMessageNode(p.senderId);
                          }}
                          icon={<Mail aria-hidden className="h-3.5 w-3.5" size={14} />}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canAdminRoom && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className={FIELD_LABEL_CLASS}>{t('roomsPanel.membersAclHeading')}</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      void handleRefreshAcl();
                    }}
                    disabled={!isConnected || aclLoading}
                    aria-label={t('roomsPanel.membersRefreshAcl')}
                  >
                    {aclLoading
                      ? t('roomsPanel.membersAclLoading')
                      : t('roomsPanel.membersRefreshAcl')}
                  </Button>
                </div>
                <p className="text-muted text-xs">{t('roomsPanel.membersAclRemoteHint')}</p>
                {aclError && <p className={NOTICE_CLASS.error}>{aclError}</p>}
                {aclFetchedAt != null && (
                  <p className="text-muted text-xs">
                    {t('roomsPanel.membersAclLastFetched', {
                      time: formatTimestamp(aclFetchedAt),
                    })}
                  </p>
                )}
                {aclEntries.length === 0 && !aclLoading ? (
                  <p className="text-muted text-xs">{t('roomsPanel.membersAclEmpty')}</p>
                ) : (
                  <ul className="space-y-1">
                    {aclEntries.map((entry) => (
                      <li
                        key={`${entry.pubkeyHex}:${entry.permissionLevel}`}
                        className="bg-app-bg border-ink-800 space-y-1 rounded-lg border px-2 py-1.5"
                      >
                        <span className="text-label text-ink-300 block font-mono break-all">
                          {entry.pubkeyHex}
                        </span>
                        <span className="text-xs text-orange-200">
                          {meshcoreRoomAclLevelLabel(entry.permissionLevel, t)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    ) : undefined;

  const conversation = (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {conversationHeader}

      {selectedRoomId == null && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted text-sm">{t('roomsPanel.selectRoom')}</p>
          {listToggle}
        </div>
      )}

      {loginAllInProgress && (
        <div className="bg-brand-green/10 text-bright-green border-ink-800 border-b px-3 py-2 text-xs">
          {t('roomsPanel.loginAllInProgress', {
            count: Math.max(loginQueueCount, localLoginRoomIds.size),
          })}
        </div>
      )}

      {selectedRoomId != null && !loggedIn && otherRoomLoginInProgress && (
        <div className="flex flex-wrap items-center gap-2 border-b border-orange-700/50 bg-orange-950/40 px-3 py-2 text-xs text-orange-200">
          <p className="min-w-0 flex-1">
            {loginQueueCount > 1
              ? t('roomsPanel.loggingInQueue', {
                  count: loginQueueCount,
                  name: activeLoginRoomName,
                })
              : t('roomsPanel.loggingInOtherRoom', { name: activeLoginRoomName })}
          </p>
          <Button size="sm" onClick={handleCancelLogin} aria-label={t('roomsPanel.cancelLogin')}>
            {t('roomsPanel.cancelLogin')}
          </Button>
        </div>
      )}

      {loginCard}

      {selectedRoomId != null && !loggedIn && selectedRoomLoginLoading && (
        <div className="text-ink-300 flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <p className="inline-flex items-center gap-2">
            <StatusDot tone="warn" pulse size="md" />
            {t('roomsPanel.loggingIn')}
          </p>
          <p className="text-muted max-w-xs text-xs">{t('roomsPanel.cancelLoginHint')}</p>
          <Button onClick={handleCancelLogin} aria-label={t('roomsPanel.cancelLogin')}>
            {t('roomsPanel.cancelLogin')}
          </Button>
        </div>
      )}

      {selectedRoomId != null && loggedIn && (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {showSearch && streamView === 'posts' && (
            <div className="border-ink-800 shrink-0 border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                  placeholder={t('chatPanel.searchMessagesPlaceholder')}
                  aria-label={t('chatPanel.searchMessagesPlaceholder')}
                  spellCheck={false}
                  className={INPUT_CLASS}
                />
                {searchQuery && (
                  <IconButton
                    size="sm"
                    aria-label={t('common.clear')}
                    onClick={() => {
                      setSearchQuery('');
                    }}
                    icon={<X aria-hidden className="h-4 w-4" size={16} />}
                  />
                )}
              </div>
              {searchQuery && (
                <div className="text-muted mt-1 text-xs">
                  {t('chatPanel.searchResults', { count: filteredRoomPosts.length })}
                </div>
              )}
            </div>
          )}
          {showDatePicker && streamView === 'posts' && (
            <div className="border-ink-800 flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <input
                type="date"
                value={jumpDate}
                max={new Date().toISOString().slice(0, 10)}
                aria-label={t('chatPanel.jumpToDate')}
                onChange={(e) => {
                  setJumpDate(e.target.value);
                  handleJumpToDate(e.target.value);
                }}
                className={`${INPUT_CLASS} max-w-48`}
              />
              <IconButton
                size="sm"
                aria-label={t('common.close')}
                onClick={() => {
                  setJumpDate('');
                  setShowDatePicker(false);
                }}
                icon={<X aria-hidden className="h-4 w-4" size={16} />}
              />
            </div>
          )}
          {filterSender != null && streamView === 'posts' && (
            <div className="bg-app-bg border-ink-800 text-ink-300 flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
              <span className="min-w-0 truncate">
                {t('chatPanel.filteringBySender', {
                  name:
                    nodes.get(filterSender)?.long_name?.trim() || `#${filterSender.toString(16)}`,
                })}
              </span>
              <IconButton
                size="sm"
                aria-label={t('chatPanel.clearSenderFilter')}
                onClick={() => {
                  setFilterSender(null);
                }}
                icon={<X aria-hidden className="h-4 w-4" size={16} />}
              />
            </div>
          )}

          {leaveError && (
            <p role="alert" className="border-ink-800 border-b px-3 py-2 text-sm text-red-400">
              {leaveError}
            </p>
          )}

          {selectedRoomLeaveLoading && (
            <div className="bg-app-bg/85 text-ink-300 absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm">
              <p>{t('roomsPanel.leaveRoomInProgress')}</p>
              <p className="text-muted max-w-xs text-xs">{t('roomsPanel.leaveRoomHint')}</p>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            <div
              ref={streamRef}
              data-testid="rooms-post-stream"
              onScroll={handleStreamScroll}
              className="h-full min-h-0 overflow-y-auto overscroll-contain px-3 py-2 [overflow-anchor:none]"
            >
              {streamView === 'starred' ? (
                roomStarred.length === 0 ? (
                  <p className="text-muted text-sm">{t('chatPanel.noStarredMessages')}</p>
                ) : (
                  roomStarred.map((s) => {
                    const roomLabel = s.viewKey.startsWith('room:')
                      ? (nodes.get(Number.parseInt(s.viewKey.slice(5), 10))?.long_name ?? s.viewKey)
                      : s.viewKey;
                    return (
                      <div
                        key={s.starId}
                        className="bg-app-bg border-ink-800 mb-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <div className="text-ink-400 mb-1 flex items-baseline gap-2 text-xs">
                          <span className="text-ink-300 font-medium">{s.sender_name}</span>
                          <span>{formatTimestamp(s.timestamp)}</span>
                          <span className="bg-secondary-dark text-label text-ink-300 rounded-md px-1.5">
                            {roomLabel}
                          </span>
                        </div>
                        <p className="text-ink-200 break-words whitespace-pre-wrap">{s.payload}</p>
                        <button
                          type="button"
                          onClick={() => {
                            const [, roomRaw] = s.viewKey.split(':');
                            const roomId = Number.parseInt(roomRaw ?? '', 10);
                            if (Number.isFinite(roomId)) {
                              suppressNextRoomSwitchScrollRef.current = true;
                              setTriggerScrollToUnread(0);
                              handleSelectRoom(roomId);
                            }
                            setStreamView('posts');
                            setScrollToRowKey(s.starId);
                          }}
                          className="text-bright-green mt-2 text-xs hover:underline"
                          aria-label={t('chatPanel.goToMessage')}
                        >
                          {t('chatPanel.goToMessage')}
                        </button>
                      </div>
                    );
                  })
                )
              ) : filteredRoomPosts.length === 0 ? (
                <p className="text-muted text-sm">
                  {searchQuery.trim() || filterSender != null
                    ? t('chatPanel.emptyNoSearchMatches')
                    : t('roomsPanel.noPostsYet')}
                </p>
              ) : (
                <div
                  ref={postVirtualizer.containerRef}
                  className="relative w-full"
                  style={{ height: `${postVirtualizer.getTotalSize()}px` }}
                >
                  {postVirtualizer.getVirtualItems().map((vi) => {
                    const index = vi.index;
                    const m = filteredRoomPosts[index];
                    if (!m) return null;
                    const isOwn = m.sender_id === myNodeNum;
                    const starId = roomMsgStarId(m);
                    const isStarred = starredIdSet.has(starId);
                    const showDm =
                      onMessageNode != null && canDmMeshcorePoster(m.sender_id, myNodeNum, nodes);
                    const isUnreadStart = index === unreadStartIndex;
                    const daySeparator = daySeparatorIndices.has(index) ? (
                      <div className="flex items-center gap-3 py-2">
                        <div className="border-ink-700 flex-1 border-t" />
                        <span className="text-muted shrink-0 text-xs font-medium">
                          {formatDayLabel(m.timestamp, t)}
                        </span>
                        <div className="border-ink-700 flex-1 border-t" />
                      </div>
                    ) : null;
                    const prevMsg = index > 0 ? filteredRoomPosts[index - 1] : null;
                    const nextMsg =
                      index < filteredRoomPosts.length - 1 ? filteredRoomPosts[index + 1] : null;
                    const isContinuation =
                      compactMode &&
                      daySeparator === null &&
                      prevMsg !== null &&
                      prevMsg.sender_id === m.sender_id;
                    const isFollowedByContinuation =
                      compactMode &&
                      nextMsg !== null &&
                      nextMsg.sender_id === m.sender_id &&
                      !daySeparatorIndices.has(index + 1);
                    const compactMerged =
                      compactMode && (isContinuation || isFollowedByContinuation);
                    const compactStackTop = compactMode && isContinuation;
                    const compactStackBottom = compactMode && isFollowedByContinuation;
                    return (
                      <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={postVirtualizer.measureElement}
                        className={`absolute top-0 left-0 w-full ${compactMode ? 'pb-0.5' : 'pb-2'}`}
                        style={{ transform: `translateY(${vi.start}px)` }}
                      >
                        {daySeparator}
                        {isUnreadStart && (
                          <div ref={attachUnreadDividerRef}>
                            <RoomUnreadDivider label={t('roomsPanel.newMessagesDivider')} />
                          </div>
                        )}
                        <div className={isContinuation ? '!mt-0' : undefined}>
                          <div
                            className={`group/msg rounded-lg px-3 text-sm ${
                              compactMode ? 'py-1' : 'py-2'
                            } ${
                              isOwn
                                ? 'border-chat-outgoing-border bg-chat-outgoing-bg text-ink-100 border'
                                : 'border-chat-incoming-border bg-chat-incoming-bg text-ink-200 border'
                            } ${
                              compactMerged
                                ? compactStackTop
                                  ? 'rounded-t-none border-t-0'
                                  : compactStackBottom
                                    ? 'rounded-b-none'
                                    : 'rounded-none border-t-0'
                                : ''
                            }`}
                          >
                            <div className="text-ink-400 mb-1 flex items-baseline gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  setFilterSender((prev) =>
                                    prev === m.sender_id ? null : m.sender_id,
                                  );
                                }}
                                className={`font-medium hover:underline ${
                                  filterSender === m.sender_id ? 'text-indigo-300' : 'text-ink-300'
                                }`}
                                aria-pressed={filterSender === m.sender_id}
                              >
                                {m.sender_name}
                              </button>
                              <span>{formatTimestamp(m.timestamp)}</span>
                              <div
                                className={`message-actions-bar ml-auto flex items-center gap-1 rounded transition-opacity ${
                                  alwaysShowMessageActions
                                    ? 'opacity-100'
                                    : 'opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100'
                                }`}
                              >
                                {showDm && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onMessageNode?.(m.sender_id);
                                    }}
                                    {...{ [PARENT_HOVER_ATTR]: '' }}
                                    className="message-action text-muted rounded p-0.5"
                                    aria-label={t('nodeDetailModal.messageButton')}
                                    title={t('nodeDetailModal.messageButton')}
                                  >
                                    <Mail
                                      aria-hidden
                                      className="h-3.5 w-3.5"
                                      trigger={parentIconTrigger}
                                      size={14}
                                    />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    toggleStar(m);
                                  }}
                                  {...{ [PARENT_HOVER_ATTR]: '' }}
                                  className={`message-action-star rounded p-0.5 ${
                                    isStarred ? 'starred' : 'text-muted'
                                  }`}
                                  aria-label={
                                    isStarred
                                      ? t('chatPanel.unstarMessage')
                                      : t('chatPanel.starMessage')
                                  }
                                  title={
                                    isStarred
                                      ? t('chatPanel.unstarMessage')
                                      : t('chatPanel.starMessage')
                                  }
                                >
                                  <Star
                                    aria-hidden
                                    className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`}
                                    trigger={parentIconTrigger}
                                    size={14}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void writeClipboardText(m.payload).catch((err: unknown) => {
                                      console.warn(
                                        '[RoomsPanel] copy failed ' + errLikeToLogString(err),
                                      );
                                    });
                                  }}
                                  {...{ [PARENT_HOVER_ATTR]: '' }}
                                  className="message-action text-muted rounded p-0.5"
                                  aria-label={t('chatPanel.copyMessage')}
                                  title={t('chatPanel.copyMessage')}
                                >
                                  <Copy
                                    aria-hidden
                                    className="h-3.5 w-3.5"
                                    trigger={parentIconTrigger}
                                    size={14}
                                  />
                                </button>
                              </div>
                            </div>
                            <div className="break-words whitespace-pre-wrap">
                              <ChatPayloadText
                                text={m.payload}
                                query={searchQuery}
                                loadLinkPreviews
                                onContentResize={() => {
                                  schedulePostRowRemeasure(index);
                                }}
                              />
                            </div>
                            {isOwn && m.status && selectedRoomId != null && (
                              <div className="mt-0.5 flex items-center justify-end gap-1">
                                {m.status === 'failed' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onSendRoomPost(selectedRoomId, m.payload);
                                    }}
                                    className="text-muted hover:text-ink-300 transition-colors"
                                    title={t('chatPanel.resendMessage')}
                                    aria-label={t('chatPanel.resendMessage')}
                                  >
                                    <RotateCw aria-hidden className="h-3.5 w-3.5" size={14} />
                                  </button>
                                )}
                                <MessageStatusBadge
                                  status={m.status}
                                  transport="device"
                                  connectionType={connectionType}
                                  error={m.error ?? undefined}
                                  context="room"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {showScrollTopButton && streamView === 'posts' && (
              <button
                type="button"
                onClick={scrollToTop}
                className="bg-deep-black hover:bg-sidebar-active-bg shadow-level-3 border-ink-700 text-ink-200 absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                aria-label={t('aria.backToTop')}
              >
                <ArrowUp aria-hidden className="h-3.5 w-3.5" size={14} />
                {t('aria.backToTop')}
              </button>
            )}
            {showScrollButton && streamView === 'posts' && (
              <button
                type="button"
                onClick={() => {
                  scrollToUnreadOrBottom();
                }}
                {...{ [PARENT_HOVER_ATTR]: '' }}
                className="bg-deep-black hover:bg-sidebar-active-bg shadow-level-3 border-ink-700 text-ink-200 absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                aria-label={
                  unreadDividerTimestamp > 0
                    ? t('roomsPanel.jumpToUnread')
                    : t('roomsPanel.jumpToLatest')
                }
              >
                <ArrowDown
                  aria-hidden
                  className="h-3.5 w-3.5"
                  trigger={parentIconTrigger}
                  size={14}
                />
                {unreadDividerTimestamp > 0
                  ? t('roomsPanel.jumpToUnread')
                  : t('roomsPanel.jumpToLatest')}
              </button>
            )}
          </div>

          <div
            className={`border-ink-800 shrink-0 border-t p-3 ${streamView === 'starred' ? 'hidden' : ''}`}
            data-testid="rooms-composer-footer"
          >
            {!canPost ? (
              <div className="space-y-2">
                <p className="text-xs text-orange-200">{t('roomsPanel.readOnlyHint')}</p>
                <p className="text-ink-300 text-xs font-medium">{t('roomsPanel.upgradeAccess')}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                    className={INPUT_CLASS}
                    aria-label={t('roomsPanel.guestPasswordLabel')}
                  />
                  <Button
                    variant="primary"
                    onClick={handleLogin}
                    disabled={!upgradeLoginEnabled}
                    aria-label={t('roomsPanel.upgradeAccess')}
                  >
                    {selectedRoomLoginLoading
                      ? t('roomsPanel.loggingIn')
                      : t('roomsPanel.upgradeAccess')}
                  </Button>
                </div>
                <label className="text-ink-300 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={rememberPassword}
                    onChange={(e) => {
                      setRememberPassword(e.target.checked);
                    }}
                    disabled={!isConnected || selectedRoomLoginLoading}
                  />
                  {t('roomsPanel.rememberPassword')}
                </label>
                {guestFieldEmpty && (
                  <p className="text-xs text-orange-200">{t('roomsPanel.emptyGuestLoginHint')}</p>
                )}
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
                composerContext="room"
                placeholder={t('roomsPanel.postPlaceholder')}
                sendButtonLabel={t('roomsPanel.postButton')}
                sendingButtonLabel={t('roomsPanel.posting')}
                mentionNodes={mentionNodes}
                onSendChunk={handleSendChunk}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="text-ink-100 flex h-full min-h-0 w-full min-w-0">
      {forgetConfirmNodeId != null && (
        <ConfirmModal
          title={t('roomsPanel.forgetSavedPasswordConfirmTitle')}
          message={t('roomsPanel.forgetSavedPasswordConfirmBody')}
          confirmLabel={t('roomsPanel.forgetSavedPassword')}
          danger
          onConfirm={() => {
            void handleConfirmForgetSavedPassword();
          }}
          onCancel={() => {
            setForgetConfirmNodeId(null);
          }}
        />
      )}
      <ConversationLayout
        mode={layoutMode}
        list={listColumn}
        listLabel={t('roomsPanel.title')}
        listOpen={!roomListCollapsed}
        compactPane={compactPane}
        conversation={conversation}
        side={detailsPanel}
        sideLabel={t('roomsPanel.details')}
        sideOpen={detailsOpen}
        sideWidth="wide"
        onCloseSide={() => {
          setDetailsOpen(false);
        }}
        closeSideLabel={t('roomsPanel.hideDetails')}
      />
    </div>
  );
}
