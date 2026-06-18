/* eslint-disable react-hooks/incompatible-library */
import 'emoji-picker-element';

import { useVirtualizer } from '@tanstack/react-virtual';
import type { TFunction } from 'i18next';
import {
  Archive,
  ArrowDown,
  Bell,
  BellOff,
  Calendar,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  ListFilter,
  Mail,
  PARENT_HOVER_ATTR,
  RotateCcw,
  Search,
  Smile,
  Star,
} from 'lucide-react-motion';
import {
  type ComponentProps,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatShortRelativeAgo } from '@/renderer/lib/formatShortRelativeAgo';
import { useIconTrigger, useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import {
  MeshtasticHybridPathIcons,
  MeshtasticMqttPathIcon,
  MeshtasticRfPathIcon,
} from '@/renderer/lib/meshtasticSourceIcons';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import type { ChatExportMessage } from '@/shared/electron-api.types';
import { formatIsoDate, formatIsoDateTime } from '@/shared/formatIsoDate';
import { formatMeshtasticNodeId, isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

import type { OutboxEntry } from '../../shared/electron-api.types';
import { isMeshcoreRoomChatMessage } from '../hooks/meshcore/meshcoreHookPreamble';
import { useChatOutbox } from '../hooks/useChatOutbox';
import { useNowMs } from '../hooks/useNowMs';
import { playMessageNotification } from '../lib/chatNotifications';
import {
  dismissedDmTabsStorageKey,
  lastReadStorageKey,
  loadMutedViews,
  loadOpenDmTabsInitial,
  loadPersistedLastReadInitial,
  loadStarred,
  notifyPersistedLastReadChanged,
  openDmTabsStorageKey,
  saveMutedViews,
  saveStarred,
  type StarredMessage,
} from '../lib/chatPanelProtocolStorage';
import {
  CHAT_SCROLL_END_THRESHOLD,
  CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX,
  createChatScrollAdjustPredicate,
  createStableChatMeasureElement,
  estimateChatRowHeight,
  findFirstMessageIndexByDayKey,
  findMessageIndexByKey,
  getChatDayKey,
  getDistFromChatBottom,
  scheduleVirtualRowRemeasure,
} from '../lib/chatScrollUtils';
import {
  type ChatUnreadDmOptions,
  computeChannelUnreadCounts,
  computeDmUnreadCounts,
  pickAudibleNotificationType,
  resolveChatDmPeer,
} from '../lib/chatUnreadCounts';
import {
  findMeshcoreParentMessageForReply,
  meshcoreChatMessagesForDisplay,
} from '../lib/meshcoreChannelText';
import { nodeDisplayName } from '../lib/nodeLongNameOrHex';
import { clampReadWatermarkMs, effectiveMessageTimestampMs } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import { emojiDisplayLabel, reactionDisplayGlyph, reactionGlyphFromPicker } from '../lib/reactions';
import { findMeshtasticParentMessageForReply, truncateReplyPreviewText } from '../lib/replyPreview';
import { CHAT_COMPACT_CONTINUATION_TIME_GAP_MS } from '../lib/timeConstants';
import type { ChatMessage, MeshNode, MeshProtocol } from '../lib/types';
import type { RequestStoreForwardHistoryResult } from '../runtime/useMeshtasticRuntime';
import { ChatComposer } from './ChatComposer';
import { ChatPayloadText } from './ChatPayloadText';
import { HelpTooltip } from './HelpTooltip';
import { MessageStatusBadge } from './MessageStatusBadge';
import { useToast } from './Toast';

function chatPanelIsLinux(): boolean {
  return window.electronAPI.getPlatform() === 'linux';
}

/** Toolbar icon button with Electron-friendly HelpTooltip (native `title` does not show). */
function ChatToolbarTooltipButton({
  tooltip,
  children,
  className,
  ...buttonProps
}: {
  tooltip: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <HelpTooltip text={tooltip} className="shrink-0">
      <button
        type="button"
        {...{ [PARENT_HOVER_ATTR]: '' }}
        className={
          className ?? 'text-muted shrink-0 rounded-lg p-1.5 transition-colors hover:text-gray-300'
        }
        {...buttonProps}
      >
        {children}
      </button>
    </HelpTooltip>
  );
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

function DmPeerInfoBar({ dmNode, nowMs, t }: { dmNode: MeshNode; nowMs: number; t: TFunction }) {
  const parts: string[] = [];
  if (dmNode.battery > 0) parts.push(t('chatPanel.dmNodeBattery', { pct: dmNode.battery }));
  const rel =
    dmNode.last_heard != null && dmNode.last_heard > 0
      ? formatShortRelativeAgo(nowMs, dmNode.last_heard)
      : null;
  if (rel) parts.push(t('chatPanel.dmNodeLastHeard', { time: rel }));
  if (dmNode.snr !== 0) parts.push(t('chatPanel.dmNodeSignal', { snr: dmNode.snr }));
  if (dmNode.hops_away != null && dmNode.hops_away > 0) {
    parts.push(
      dmNode.hops_away === 1
        ? t('chatPanel.dmNodeHops', { count: dmNode.hops_away })
        : t('chatPanel.dmNodeHopsPlural', { count: dmNode.hops_away }),
    );
  }
  if (parts.length === 0) return null;
  return (
    <div
      className="mb-2 flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-3 py-1.5 text-xs text-gray-400"
      role="status"
      aria-label="DM peer info"
    >
      {parts.join(' · ')}
    </div>
  );
}

function OutboxBubble({
  row,
  onRetry,
  onCancel,
}: {
  row: OutboxEntry;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  const { t } = useTranslation();
  const statusLabel =
    row.status === 'queued'
      ? t('chatPanel.outboxStatusQueued')
      : row.status === 'sending'
        ? t('chatPanel.outboxStatusSending')
        : row.status === 'blocked'
          ? t('chatPanel.outboxStatusBlocked')
          : t('chatPanel.outboxStatusFailed');
  const statusColor =
    row.status === 'queued'
      ? 'text-muted'
      : row.status === 'sending'
        ? 'text-muted'
        : row.status === 'blocked'
          ? 'text-amber-400'
          : 'text-red-400';
  return (
    <div className="mb-1 flex justify-end px-4">
      <div className="max-w-[75%] rounded-xl bg-slate-700 px-3 py-2 opacity-80">
        <div className="text-sm text-white">{row.payload}</div>
        <div className={`mt-1 flex items-center gap-2 text-[11px] ${statusColor}`}>
          <span>{statusLabel}</span>
          {row.error && (
            <span className="text-muted max-w-[140px] truncate" title={row.error}>
              — {row.error}
            </span>
          )}
          {(row.status === 'failed' || row.status === 'blocked') && (
            <button
              aria-label={t('chatPanel.retryOutboxMessage')}
              onClick={() => {
                onRetry(row.id);
              }}
              className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-slate-500"
            >
              {t('chatPanel.retryOutbox')}
            </button>
          )}
          <button
            aria-label={t('chatPanel.cancelOutboxMessage')}
            onClick={() => {
              onCancel(row.id);
            }}
            className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-slate-500"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransportBadge({ via }: { via: 'rf' | 'mqtt' | 'both' }) {
  const { t } = useTranslation();
  const rfLabel = t('chatPanel.receivedViaRf');
  const mqttLabel = t('chatPanel.receivedViaMqtt');
  const rfIcon = (
    <span role="img" title={rfLabel} aria-label={rfLabel}>
      <MeshtasticRfPathIcon />
    </span>
  );
  const mqttIcon = (
    <span role="img" title={mqttLabel} aria-label={mqttLabel}>
      <MeshtasticMqttPathIcon />
    </span>
  );

  if (via === 'both') {
    const bothLabel = t('chatPanel.receivedViaRfAndMqtt');
    return <MeshtasticHybridPathIcons title={bothLabel} ariaLabel={bothLabel} />;
  }
  return via === 'rf' ? rfIcon : mqttIcon;
}

function StoreForwardBadge() {
  const { t } = useTranslation();
  const trigger = useIconTrigger();
  const label = t('chatPanel.receivedViaStoreForward');
  return (
    <span role="img" title={label} aria-label={label}>
      <Archive aria-hidden className="h-3 w-3 text-amber-400" trigger={trigger} size={12} />
    </span>
  );
}

/** Format a date for day separators */
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
function UnreadDivider() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-red-500/50" />
      <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-red-400 uppercase">
        {t('chatPanel.newMessagesDivider')}
      </span>
      <div className="flex-1 border-t border-red-500/50" />
    </div>
  );
}

function withoutDmNode(source: Record<number, number>, nodeNum: number): Record<number, number> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => Number(key) !== nodeNum));
}

function latestMessageTimestamp(messages: readonly ChatMessage[], nowMs = Date.now()): number {
  let latest = 0;
  for (const msg of messages) {
    const ts = effectiveMessageTimestampMs(msg.timestamp, nowMs);
    if (ts > latest) latest = ts;
  }
  return clampReadWatermarkMs(latest, nowMs);
}

function mergeReadWatermarks(
  prev: Record<string, number>,
  watermarks: Iterable<readonly [string, number]>,
): Record<string, number> {
  let next = prev;
  for (const [key, value] of watermarks) {
    if (value <= 0) continue;
    if ((next[key] ?? 0) >= value) continue;
    if (next === prev) next = { ...prev };
    next[key] = value;
  }
  return next;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  /** Live message list for unread badges when `messages` is frozen (leaving Chat tab). */
  messagesForUnread?: ChatMessage[];
  channels: { index: number; name: string }[];
  myNodeNum: number;
  ownNodeIds?: number[];
  onSend: (
    text: string,
    channel: number,
    destination?: number,
    replyId?: number,
  ) => void | Promise<void>;
  onReact: (glyph: string, replyId: number, channel: number) => Promise<void>;
  onResend: (msg: ChatMessage) => void;
  onNodeClick: (nodeNum: number) => void;
  isConnected: boolean;
  isMqttOnly?: boolean;
  connectionType?: 'ble' | 'serial' | 'http' | null;
  nodes: Map<number, MeshNode>;
  initialDmTarget?: number | null;
  onDmTargetConsumed?: () => void;
  isActive?: boolean;
  /** When `meshcore`, show full names, hide redundant RF-only transport badge. */
  protocol?: MeshProtocol;
  /** Ref for scroll-to-top (Chat has its own Top button positioned inside the message list). */
  scrollToTopRef?: React.RefObject<(() => void) | null>;
  /**
   * Main app scrollport (e.g. App `mainViewportRef`). When the message list does not
   * overflow its own `overflow-y-auto` box, chat still scrolls inside this root; we use
   * it to measure whether the user has scrolled away from the latest messages.
   */
  outerScrollMetricsRootRef?: React.RefObject<HTMLElement | null>;
  compactMode?: boolean;
  /** Meshtastic RF: request Store & Forward chat history from the router. */
  onFetchStoreForwardHistory?: () => Promise<RequestStoreForwardHistoryResult>;
  /** MeshCore MsgWaiting drain — messages queued on device. */
  waitingMessagesCount?: number;
  onSyncWaitingMessages?: () => void;
}

function ChatPanel({
  messages,
  messagesForUnread,
  channels,
  myNodeNum,
  ownNodeIds,
  onSend,
  onReact,
  onResend,
  onNodeClick,
  isConnected,
  isMqttOnly,
  connectionType,
  nodes,
  initialDmTarget,
  onDmTargetConsumed,
  isActive = true,
  protocol = 'meshtastic',
  scrollToTopRef,
  outerScrollMetricsRootRef,
  compactMode = false,
  onFetchStoreForwardHistory,
  waitingMessagesCount = 0,
  onSyncWaitingMessages,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const parentIconTrigger = useParentIconTrigger();
  const { addToast } = useToast();
  const ownNodeIdSet = useMemo(() => {
    const base = ownNodeIds != null && ownNodeIds.length > 0 ? ownNodeIds : [myNodeNum];
    return new Set(base.filter((id) => id > 0));
  }, [myNodeNum, ownNodeIds]);

  const isOwnNode = useCallback((nodeId: number) => ownNodeIdSet.has(nodeId), [ownNodeIdSet]);

  const meshcoreExcludeDmPeer = useMemo((): ChatUnreadDmOptions['excludeDmPeer'] | undefined => {
    if (protocol !== 'meshcore') return undefined;
    return (peer: number) => nodes.get(peer)?.hw_model === 'Room';
  }, [nodes, protocol]);

  const chatUnreadDmOptions = useMemo(
    (): ChatUnreadDmOptions | undefined =>
      meshcoreExcludeDmPeer ? { excludeDmPeer: meshcoreExcludeDmPeer } : undefined,
    [meshcoreExcludeDmPeer],
  );

  const composerSelfDisplayName = useMemo(() => {
    if (protocol !== 'meshcore') return undefined;
    return nodeDisplayName(nodes.get(myNodeNum), protocol) || undefined;
  }, [protocol, nodes, myNodeNum]);

  /** DM peer for a message, excluding broadcast and non-DM traffic. */
  const resolveDmPeer = useCallback(
    (msg: ChatMessage): number | undefined =>
      resolveChatDmPeer(msg, ownNodeIdSet, protocol, chatUnreadDmOptions),
    [chatUnreadDmOptions, ownNodeIdSet, protocol],
  );

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useImperativeHandle(scrollToTopRef, () => scrollToTop, [scrollToTop]);
  const [channel, setChannel] = useState(() => (channels.length > 0 ? channels[0].index : 0));
  useEffect(() => {
    if (channels.length > 0 && !channels.some((c) => c.index === channel)) {
      setChannel(channels[0].index);
    }
  }, [channels, channel]);
  const [chatActionError, setChatActionError] = useState<{
    message: string;
    viewKey: string;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** Sticky intent: user is reading latest messages and wants auto-follow on new traffic. */
  const isPinnedToBottomRef = useRef(true);
  const savedScrollTopRef = useRef<number | null>(null);
  const savedWasPinnedToBottomRef = useRef(false);
  /** Distinguishes a tab return (isActive false→true) from a view switch while already active. */
  const wasActiveRef = useRef(isActive);
  const reactionPickerRef = useRef<HTMLElement | null>(null);
  const reactionPickerTarget = useRef<{ id: number; channel: number } | null>(null);
  const reactionHiddenInputRef = useRef<HTMLInputElement | null>(null);

  const handleReactRef = useRef<
    ((glyph: string, packetId: number, msgChannel: number) => Promise<void>) | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Feature: sender filter
  const [filterSender, setFilterSender] = useState<number | null>(null);

  // Feature: jump to date
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [jumpDate, setJumpDate] = useState('');

  const prevMessagesLengthRef = useRef(messages.length);

  // Feature: per-conversation mute
  const [mutedViews, setMutedViews] = useState<Set<string>>(() => loadMutedViews(protocol));

  // Feature: message starring
  const [starred, setStarred] = useState<StarredMessage[]>(() => loadStarred(protocol));
  const starredIdSet = useMemo(() => new Set(starred.map((s) => s.starId)), [starred]);

  // Two-section UI state — load DM tabs from localStorage for restart persistence
  const [viewMode, setViewMode] = useState<'channels' | 'dm' | 'starred'>('channels');
  const [openDmTabs, setOpenDmTabs] = useState<number[]>(() => loadOpenDmTabsInitial(protocol));
  const openDmTabsRef = useRef(openDmTabs);
  openDmTabsRef.current = openDmTabs;
  const [activeDmNode, setActiveDmNode] = useState<number | null>(null);
  const [dismissedDmTabs, setDismissedDmTabs] = useState<Record<number, number>>(() => {
    const raw = localStorage.getItem(dismissedDmTabsStorageKey(protocol));
    const parsed = parseStoredJson<Record<string, number>>(raw, 'ChatPanel dismissedDmTabs');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<number, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const node = Number(key);
      if (!Number.isFinite(node) || typeof value !== 'number') continue;
      // Back-compat: older versions stored `Date.now()` here (ms since epoch).
      // We now store an inferred DM message-count. If the value looks like a timestamp,
      // treat it as "dismissed nothing" so conversations can resurface.
      const looksLikeTimestamp = value > 10_000_000_000;
      out[node] = looksLikeTimestamp ? 0 : value;
    }
    return out;
  });

  // Persist openDmTabs to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(openDmTabsStorageKey(protocol), JSON.stringify(openDmTabs));
    } catch (e) {
      console.warn('[ChatPanel] persist openDmTabs failed ' + errLikeToLogString(e));
    }
  }, [openDmTabs, protocol]);

  useEffect(() => {
    try {
      localStorage.setItem(dismissedDmTabsStorageKey(protocol), JSON.stringify(dismissedDmTabs));
    } catch (e) {
      console.warn('[ChatPanel] persist dismissedDmTabs failed ' + errLikeToLogString(e));
    }
  }, [dismissedDmTabs, protocol]);

  // Persisted lastRead: { "ch:0": timestamp, "ch:2": ..., "dm:12345678": ... }
  const [persistedLastRead, setPersistedLastRead] = useState<Record<string, number>>(() =>
    loadPersistedLastReadInitial(protocol),
  );
  // Ref mirror — lets view-switch effect read latest value without adding it to deps
  const persistedLastReadRef = useRef(persistedLastRead);
  persistedLastReadRef.current = persistedLastRead;

  // Snapshot of lastRead taken at the moment of view switch (for divider calculation)
  const [unreadDividerTimestamp, setUnreadDividerTimestamp] = useState(0);

  // Counter-based trigger: increment → useLayoutEffect fires scroll-to-divider
  const [triggerScrollToUnread, setTriggerScrollToUnread] = useState(0);

  // Ref to divider DOM node for scroll-past detection
  const unreadDividerRef = useRef<HTMLDivElement>(null);

  const attachUnreadDividerRef = useCallback((node: HTMLDivElement | null) => {
    unreadDividerRef.current = node;
  }, []);

  // Persist lastRead timestamps to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(lastReadStorageKey(protocol), JSON.stringify(persistedLastRead));
      notifyPersistedLastReadChanged(protocol);
    } catch (e) {
      console.warn('[ChatPanel] persist lastRead failed ' + errLikeToLogString(e));
    }
  }, [persistedLastRead, protocol]);

  const unreadSourceMessages = messagesForUnread ?? messages;
  const prevUnreadSourceLengthRef = useRef(unreadSourceMessages.length);

  const getDmLabel = useCallback(
    (nodeNum: number) => {
      const node = nodes.get(nodeNum);
      const label = nodeDisplayName(node, protocol);
      return label || formatMeshtasticNodeId(nodeNum);
    },
    [nodes, protocol],
  );

  useEffect(() => {
    setReplyTo(null);
    setMutedViews(loadMutedViews(protocol));
    setStarred(loadStarred(protocol));
  }, [protocol]);

  // Handle initialDmTarget from Nodes tab
  useEffect(() => {
    if (initialDmTarget != null) {
      if (!openDmTabsRef.current.includes(initialDmTarget)) {
        setOpenDmTabs((prev) => [...prev, initialDmTarget]);
      }
      setDismissedDmTabs((prev) => {
        if (!(initialDmTarget in prev)) return prev;
        return withoutDmNode(prev, initialDmTarget);
      });
      setActiveDmNode(initialDmTarget);
      setViewMode('dm');
      onDmTargetConsumed?.();
    }
  }, [initialDmTarget, onDmTargetConsumed]);

  const displayMessages = useMemo(
    () => (protocol === 'meshcore' ? meshcoreChatMessagesForDisplay(messages) : messages),
    [messages, protocol],
  );

  // Separate regular messages from reaction messages
  const { regularMessages, reactionsByReplyId } = useMemo(() => {
    const regular: ChatMessage[] = [];
    const reactions = new Map<
      number,
      { emoji: number; payload: string; sender_id: number; sender_name: string; id?: number }[]
    >();

    for (const msg of displayMessages) {
      if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) {
        continue;
      }
      if (msg.emoji && msg.replyId) {
        const existing = reactions.get(msg.replyId) ?? [];
        existing.push({
          emoji: msg.emoji,
          payload: msg.payload,
          sender_id: msg.sender_id,
          sender_name: msg.sender_name,
          id: msg.id,
        });
        reactions.set(msg.replyId, existing);
      } else {
        regular.push(msg);
      }
    }
    return { regularMessages: regular, reactionsByReplyId: reactions };
  }, [displayMessages, protocol]);

  const inferredDmTabs = useMemo(() => {
    const peers = new Map<number, number>();
    for (const msg of regularMessages) {
      const peer = resolveDmPeer(msg);
      if (peer == null) continue;
      peers.set(peer, (peers.get(peer) ?? 0) + 1);
    }
    return peers;
  }, [regularMessages, resolveDmPeer]);

  /** Incoming DM messages per peer newer than persisted last-read for `dm:${peer}` (channel unread map skips DMs). */
  const dmUnreadCounts = useMemo(
    () =>
      computeDmUnreadCounts(
        unreadSourceMessages,
        persistedLastRead,
        ownNodeIdSet,
        protocol,
        chatUnreadDmOptions,
      ),
    [chatUnreadDmOptions, ownNodeIdSet, persistedLastRead, protocol, unreadSourceMessages],
  );

  const visibleDmTabs = useMemo(() => {
    const all = new Set(openDmTabs);
    if (activeDmNode != null) all.add(activeDmNode);
    for (const [nodeNum, dmCount] of inferredDmTabs) {
      const dismissedCount = dismissedDmTabs[nodeNum] ?? 0;
      if (dmCount > dismissedCount) {
        all.add(nodeNum);
      }
    }
    for (const [nodeNum, unread] of dmUnreadCounts) {
      if (unread > 0) all.add(nodeNum);
    }
    return Array.from(all).filter(
      (nodeNum) => protocol !== 'meshtastic' || !isMeshtasticBroadcastNodeNum(nodeNum),
    );
  }, [activeDmNode, openDmTabs, inferredDmTabs, dismissedDmTabs, dmUnreadCounts, protocol]);

  const inferredDmTabSet = useMemo(() => new Set(inferredDmTabs.keys()), [inferredDmTabs]);

  // Meshtastic / MeshCore quoted replies use protocol-specific parent lookup (see quote render below).

  const unreadCounts = useMemo(
    () =>
      computeChannelUnreadCounts(unreadSourceMessages, persistedLastRead, ownNodeIdSet, protocol),
    [ownNodeIdSet, persistedLastRead, protocol, unreadSourceMessages],
  );

  const viewMessages = useMemo(() => {
    if (viewMode === 'dm' && activeDmNode != null) {
      return regularMessages.filter(
        (m) =>
          (m.to === activeDmNode && isOwnNode(m.sender_id)) ||
          (m.sender_id === activeDmNode &&
            (isOwnNode(m.to ?? 0) ||
              (protocol === 'meshcore' && m.channel === -1 && !isOwnNode(m.sender_id)))),
      );
    }

    return regularMessages.filter((m) => !m.to && m.channel === channel);
  }, [activeDmNode, channel, isOwnNode, protocol, regularMessages, viewMode]);

  const filteredMessages = useMemo(() => {
    let msgs = viewMessages;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter(
        (m) => m.payload.toLowerCase().includes(q) || m.sender_name.toLowerCase().includes(q),
      );
    }
    if (filterSender != null) {
      msgs = msgs.filter((m) => m.sender_id === filterSender);
    }
    return msgs;
  }, [searchQuery, viewMessages, filterSender]);

  // Index of first message from another node newer than unreadDividerTimestamp.
  // Returns -1 when: search active, timestamp=0, or no qualifying messages.
  const unreadStartIndex = useMemo(() => {
    if (searchQuery.trim() || unreadDividerTimestamp === 0) return -1;
    for (let i = 0; i < filteredMessages.length; i++) {
      const msg = filteredMessages[i];
      if (!isOwnNode(msg.sender_id) && msg.timestamp > unreadDividerTimestamp) return i;
    }
    return -1;
  }, [filteredMessages, isOwnNode, searchQuery, unreadDividerTimestamp]);

  const hasUnreadDivider = unreadStartIndex >= 0;
  const unreadStartIndexRef = useRef(unreadStartIndex);
  unreadStartIndexRef.current = unreadStartIndex;

  const estimateMessageSize = useCallback(
    (index: number) => {
      const msg = filteredMessages[index];
      return estimateChatRowHeight(msg, {
        compactMode,
        unreadDividerExtra:
          index === unreadStartIndex ? CHAT_UNREAD_DIVIDER_ESTIMATE_EXTRA_PX : undefined,
      });
    },
    [compactMode, filteredMessages, unreadStartIndex],
  );

  const measureMessageElement = useMemo(
    () => createStableChatMeasureElement(estimateMessageSize),
    [estimateMessageSize],
  );

  const messageVirtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: estimateMessageSize,
    measureElement: measureMessageElement,
    overscan: 10,
    getItemKey: (index) => {
      const msg = filteredMessages[index];
      if (!msg) return index;
      return msg.id != null ? `db-${msg.id}` : `${msg.timestamp}-${msg.packetId ?? 'x'}-${index}`;
    },
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: CHAT_SCROLL_END_THRESHOLD,
  });

  messageVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = createChatScrollAdjustPredicate({
    unreadStartIndexRef,
    isPinnedToBottomRef,
  });

  const messageVirtualizerRef = useRef(messageVirtualizer);
  messageVirtualizerRef.current = messageVirtualizer;

  const scheduleMessageRowRemeasure = useCallback((rowIndex: number) => {
    scheduleVirtualRowRemeasure(
      (node) => {
        messageVirtualizerRef.current.measureElement(node);
      },
      scrollContainerRef.current,
      rowIndex,
    );
  }, []);

  const computeIsAtChatEnd = useCallback(() => {
    const inner = scrollContainerRef.current;
    if (!inner) return false;
    const virtualAtEnd = messageVirtualizerRef.current.isAtEnd(CHAT_SCROLL_END_THRESHOLD);
    const outerDist = getDistFromChatBottom(
      inner,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (outerDist != null && outerDist > CHAT_SCROLL_END_THRESHOLD) return false;
    return virtualAtEnd;
  }, [outerScrollMetricsRootRef]);

  const viewKey = useMemo(() => {
    if (viewMode === 'dm' && activeDmNode != null) return `dm:${activeDmNode}`;
    return `ch:${channel}`;
  }, [viewMode, activeDmNode, channel]);

  const outboxSendFn = useCallback(
    (text: string, ch: number, dest?: number, replyId?: number) =>
      Promise.resolve().then(() => onSend(text, ch, dest, replyId)),
    [onSend],
  );

  const {
    rows: outboxRows,
    queue: queueOutbox,
    retry: retryOutbox,
    cancel: cancelOutbox,
  } = useChatOutbox({
    protocol,
    isSendAvailable: isConnected && !(isMqttOnly && protocol === 'meshcore'),
    sendFn: outboxSendFn,
  });

  const viewOutboxRows = useMemo(
    () => outboxRows.filter((r) => r.viewKey === viewKey),
    [outboxRows, viewKey],
  );

  const markCurrentViewRead = useCallback(() => {
    if (viewMode === 'dm' && activeDmNode == null) return;

    const latest = latestMessageTimestamp(viewMessages);
    if (latest === 0) return;
    setPersistedLastRead((prev) => mergeReadWatermarks(prev, [[viewKey, latest]]));
  }, [activeDmNode, viewKey, viewMessages, viewMode]);

  // On view switch: snapshot lastRead for divider + arm scroll trigger
  useEffect(() => {
    const snapshot = persistedLastReadRef.current[viewKey] ?? 0;
    setUnreadDividerTimestamp(snapshot);
    setTriggerScrollToUnread((n) => n + 1);
  }, [viewKey]);

  const prevViewKeyForReadRef = useRef<string | null>(null);
  // Mark read when the user switches channel/DM while chat is active — not on tab re-entry alone.
  useEffect(() => {
    if (!isActive) {
      prevViewKeyForReadRef.current = viewKey;
      return;
    }
    const prev = prevViewKeyForReadRef.current;
    if (prev !== null && prev !== viewKey) {
      markCurrentViewRead();
    }
    prevViewKeyForReadRef.current = viewKey;
  }, [viewKey, isActive, markCurrentViewRead]);

  useEffect(() => {
    setFilterSender(null);
  }, [viewKey]);

  // Persist per-conversation mute
  useEffect(() => {
    saveMutedViews(protocol, mutedViews);
  }, [protocol, mutedViews]);

  // Persist starred messages
  useEffect(() => {
    saveStarred(protocol, starred);
  }, [protocol, starred]);

  // Sound notification: plays when a new message arrives on a view the user is not reading.
  useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (localStorage.getItem('mesh-client:notifMuted') === '1' || messages.length <= prevLen)
      return;
    const newMsgs = messages.slice(prevLen);
    const gated = newMsgs.filter((msg) => {
      if (isOwnNode(msg.sender_id) || msg.isHistory) return false;
      const peer = resolveDmPeer(msg);
      const msgViewKey = peer != null ? `dm:${peer}` : `ch:${msg.channel}`;
      if (mutedViews.has(msgViewKey)) return false;
      return isActive && msgViewKey !== viewKey && !document.hidden;
    });
    const type = pickAudibleNotificationType(
      gated,
      protocol,
      mutedViews,
      ownNodeIdSet,
      chatUnreadDmOptions,
      messages,
    );
    if (type) playMessageNotification(type);
  }, [
    messages,
    isActive,
    mutedViews,
    viewKey,
    isOwnNode,
    resolveDmPeer,
    protocol,
    ownNodeIdSet,
    chatUnreadDmOptions,
  ]);

  const updateScrollButtonVisibility = useCallback(() => {
    const atEnd = computeIsAtChatEnd();
    isPinnedToBottomRef.current = atEnd;
    setShowScrollButton(!atEnd);
    const distFromBottom = getDistFromChatBottom(
      scrollContainerRef.current,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (distFromBottom == null) return undefined;
    return distFromBottom;
  }, [computeIsAtChatEnd, outerScrollMetricsRootRef]);

  const applyNearBottomReadState = useCallback(
    (distFromBottom: number) => {
      if (document.hidden) return;
      if (distFromBottom < 50) {
        markCurrentViewRead();
        setUnreadDividerTimestamp(0); // hide divider once user has read to bottom
      }
    },
    [markCurrentViewRead],
  );

  // Mark active view read when new inbound traffic arrives for the open conversation.
  useEffect(() => {
    const prevLen = prevUnreadSourceLengthRef.current;
    const newLen = unreadSourceMessages.length;
    prevUnreadSourceLengthRef.current = newLen;
    if (!isActive || document.hidden || newLen <= prevLen) return;

    const newMsgs = unreadSourceMessages.slice(prevLen);
    const hasInboundForView = newMsgs.some((msg) => {
      if (isOwnNode(msg.sender_id)) return false;
      if (msg.isHistory) return false;
      if (msg.emoji && msg.replyId) return false;
      if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) return false;
      const peer = resolveDmPeer(msg);
      const msgViewKey = peer != null ? `dm:${peer}` : `ch:${msg.channel}`;
      return msgViewKey === viewKey;
    });
    if (!hasInboundForView) return;

    requestAnimationFrame(() => {
      const dist = getDistFromChatBottom(
        scrollContainerRef.current,
        messagesEndRef.current,
        outerScrollMetricsRootRef?.current ?? null,
      );
      if (dist !== null) applyNearBottomReadState(dist);
    });
  }, [
    unreadSourceMessages,
    isActive,
    viewKey,
    isOwnNode,
    resolveDmPeer,
    protocol,
    applyNearBottomReadState,
    outerScrollMetricsRootRef,
  ]);

  // Scroll tracking for scroll-to-bottom button + mark-as-read when at bottom
  const handleScroll = useCallback(() => {
    if (unreadStartIndex >= 0 && unreadDividerRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
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

  // Initialize scroll button visibility on mount — critical for async message loading (e.g., meshcore SQLite load)
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [updateScrollButtonVisibility]);

  // Refresh scroll button + mark-read when message list changes (followOnAppend handles auto-scroll when pinned).
  useEffect(() => {
    if (!isActive || document.hidden) return;
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      if (dist !== undefined) applyNearBottomReadState(dist);
    });
  }, [filteredMessages.length, isActive, updateScrollButtonVisibility, applyNearBottomReadState]);

  // Outer shell scroll (when the message list box does not overflow on its own)
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
  // false→true) from a genuine view switch while already active (channel/DM
  // change bumps triggerScrollToUnread): a tab return restores the
  // position/pin-state snapshotted on exit; a view switch scrolls to the
  // unread divider or end. These used to be two separate effects that both
  // reacted to `isActive`, so a tab return fired the view-switch scroll too
  // and the restore immediately clobbered it (visible as a jump).
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
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
          messageVirtualizerRef.current.scrollToEnd();
          isPinnedToBottomRef.current = true;
        } else if (el) {
          el.scrollTop = savedScrollTopRef.current;
        }
        savedScrollTopRef.current = null;
        savedWasPinnedToBottomRef.current = false;
      }
      return;
    }

    if (triggerScrollToUnread === 0) return; // skip initial mount
    if (unreadStartIndex >= 0) {
      messageVirtualizerRef.current.scrollToIndex(unreadStartIndex, { align: 'center' });
      isPinnedToBottomRef.current = false;
    } else {
      messageVirtualizerRef.current.scrollToEnd();
      isPinnedToBottomRef.current = true;
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      // When unread messages fit without scrolling, handleScroll never fires, so
      // check here and mark read if the user is already at the bottom.
      if (dist !== undefined && dist < 50) applyNearBottomReadState(dist);
    });
    // Only scroll on explicit view-switch trigger — not when message list or virtualizer updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- triggerScrollToUnread is the sole scroll intent
  }, [triggerScrollToUnread, isActive]);

  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [isActive, viewKey, updateScrollButtonVisibility]);

  const scrollToUnreadOrBottom = useCallback(() => {
    const el = scrollContainerRef.current;
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
      messageVirtualizerRef.current.scrollToIndex(unreadStartIndex, {
        align: 'start',
        behavior: 'smooth',
      });
    } else {
      messageVirtualizerRef.current.scrollToEnd({ behavior: 'smooth' });
      isPinnedToBottomRef.current = true;
    }
  }, [applyNearBottomReadState, outerScrollMetricsRootRef, unreadStartIndex]);

  const scrollToQuotedParent = useCallback(
    (replyKey: number) => {
      const index = findMessageIndexByKey(filteredMessages, replyKey);
      if (index < 0) return;
      isPinnedToBottomRef.current = false;
      messageVirtualizerRef.current.scrollToIndex(index, { align: 'center', behavior: 'smooth' });
    },
    [filteredMessages],
  );

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpenFor(null);
        if (replyTo) {
          setReplyTo(null);
        } else if (filterSender != null) {
          setFilterSender(null);
        } else if (showDatePicker) {
          setShowDatePicker(false);
        } else if (showSearch) {
          setShowSearch(false);
        } else if (viewMode === 'dm') {
          setViewMode('channels');
        }
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSearch, viewMode, replyTo, filterSender, showDatePicker]);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  const handleSendChunk = useCallback(
    async (text: string, opts?: { replyId?: number }) => {
      const sendChannel = channel;
      const destination = viewMode === 'dm' && activeDmNode != null ? activeDmNode : undefined;
      const sendOutcome = onSend(text, sendChannel, destination, opts?.replyId);
      await Promise.resolve(sendOutcome);
    },
    [activeDmNode, channel, onSend, viewMode],
  );

  const handleReact = async (glyph: string, packetId: number, msgChannel: number) => {
    // Match handleSend: UI uses channel -1 as "primary"; MeshCore/Meshtastic send expects 0.
    const sendChannel = msgChannel === -1 ? 0 : msgChannel;
    setPickerOpenFor(null);
    setChatActionError(null);
    try {
      console.debug('[ChatPanel] handleReact', glyph, packetId, sendChannel);
      await onReact(glyph, packetId, sendChannel);
    } catch (err) {
      console.error('[ChatPanel] React failed: ' + errLikeToLogString(err));
      setChatActionError({
        message: err instanceof Error ? err.message : 'Reaction failed',
        viewKey,
      });
    }
  };
  handleReactRef.current = handleReact;

  // Open a DM tab for a node
  const openDmTo = useCallback((nodeNum: number) => {
    setOpenDmTabs((prev) => (prev.includes(nodeNum) ? prev : [...prev, nodeNum]));
    setDismissedDmTabs((prev) => {
      if (!(nodeNum in prev)) return prev;
      return withoutDmNode(prev, nodeNum);
    });
    setActiveDmNode(nodeNum);
    setViewMode('dm');
  }, []);

  // Close a DM tab
  const closeDmTab = useCallback(
    (nodeNum: number) => {
      setOpenDmTabs((prev) => prev.filter((n) => n !== nodeNum));
      if (inferredDmTabSet.has(nodeNum)) {
        const dmCount = inferredDmTabs.get(nodeNum) ?? 0;
        setDismissedDmTabs((prev) => ({ ...prev, [nodeNum]: dmCount }));
      }
      if (activeDmNode === nodeNum) {
        // Switch to next tab or back to channels
        const remaining = visibleDmTabs.filter((n) => n !== nodeNum);
        if (remaining.length > 0) {
          setActiveDmNode(remaining[remaining.length - 1]);
        } else {
          setActiveDmNode(null);
          setViewMode('channels');
        }
      }
    },
    [activeDmNode, inferredDmTabSet, inferredDmTabs, visibleDmTabs],
  );

  function msgStarId(msg: ChatMessage): string {
    return msg.id != null ? String(msg.id) : `${msg.timestamp}-${msg.packetId ?? 'x'}`;
  }

  const toggleMuteView = useCallback((vk: string) => {
    setMutedViews((prev) => {
      const next = new Set(prev);
      if (next.has(vk)) {
        next.delete(vk);
      } else {
        next.add(vk);
      }
      return next;
    });
  }, []);

  const toggleStar = useCallback(
    (msg: ChatMessage) => {
      const starId = msgStarId(msg);
      setStarred((prev) => {
        if (prev.some((s) => s.starId === starId)) return prev.filter((s) => s.starId !== starId);
        const entry: StarredMessage = {
          starId,
          timestamp: msg.timestamp,
          payload: msg.payload,
          sender_name: msg.sender_name ?? '',
          sender_id: msg.sender_id,
          viewKey,
          channel: msg.channel,
          to: msg.to ?? null,
          starredAt: Date.now(),
        };
        return [...prev, entry];
      });
    },
    [viewKey],
  );

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatFullTimestamp(ts: number): string {
    return formatIsoDateTime(ts);
  }

  /** Flat reaction rows for a message key (chronological as stored). */
  function getReactionRows(messageKey: number | undefined) {
    if (!messageKey) return [];
    return reactionsByReplyId.get(messageKey) ?? [];
  }

  // Pre-compute day separator indices (avoids mutable variable during render)
  const daySeparatorIndices = useMemo(() => {
    const indices = new Set<number>();
    let prevDayKey = '';
    for (let i = 0; i < filteredMessages.length; i++) {
      const dayKey = getChatDayKey(filteredMessages[i].timestamp);
      if (dayKey !== prevDayKey) {
        indices.add(i);
        prevDayKey = dayKey;
      }
    }
    return indices;
  }, [filteredMessages]);

  // Linux reaction picker — attach emoji-click on the <emoji-picker> web component
  useEffect(() => {
    if (!pickerOpenFor) return;
    const el = reactionPickerRef.current;
    if (!el) return;
    const target = reactionPickerTarget.current;
    if (!target) return;
    const handler = (e: Event) => {
      const unicode = (e as CustomEvent).detail.emoji.unicode as string;
      const parsed = reactionGlyphFromPicker(unicode);
      if (parsed) {
        void handleReactRef.current?.(parsed.glyph, target.id, target.channel);
      }
    };
    el.addEventListener('emoji-click', handler);
    return () => {
      el.removeEventListener('emoji-click', handler);
    };
  }, [pickerOpenFor]);

  // macOS/Windows reaction picker — intercept emoji inserted into hidden input by showEmojiPanel()
  useEffect(() => {
    const el = reactionHiddenInputRef.current;
    if (!el) return;
    const handler = () => {
      const unicode = el.value;
      el.value = '';
      if (!unicode) return;
      const parsed = reactionGlyphFromPicker(unicode);
      const target = reactionPickerTarget.current;
      if (parsed && target) {
        void handleReactRef.current?.(parsed.glyph, target.id, target.channel);
      }
    };
    el.addEventListener('input', handler);
    return () => {
      el.removeEventListener('input', handler);
    };
  }, []);

  const isDmMode = viewMode === 'dm' && activeDmNode != null;
  const nowMs = useNowMs(isDmMode);
  const dmNodeName = activeDmNode != null ? getDmLabel(activeDmNode) : '';
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Jump to date — scroll to first message with matching day key
  const handleJumpToDate = useCallback(
    (dateStr: string) => {
      if (!dateStr) return;
      const [y, m, d] = dateStr.split('-').map(Number);
      const targetKey = `${y}-${m - 1}-${d}`;
      const index = findFirstMessageIndexByDayKey(filteredMessages, targetKey);
      if (index < 0) return;
      isPinnedToBottomRef.current = false;
      messageVirtualizerRef.current.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
      setShowDatePicker(false);
    },
    [filteredMessages],
  );

  const composePlaceholder = useMemo(
    () =>
      isDmMode
        ? t('chatPanel.composePlaceholderDm', { name: dmNodeName })
        : !isConnected
          ? t('chatPanel.composePlaceholderConnectFirst')
          : isMqttOnly
            ? t('chatPanel.composePlaceholderMqttOnly')
            : t('chatPanel.composePlaceholderDefault'),
    [isDmMode, dmNodeName, isConnected, isMqttOnly, t],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Row 1 — Channel selector + toolbar utilities */}
      <div
        className={`mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 ${viewMode === 'dm' ? 'opacity-50' : ''}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted mr-1 shrink-0 text-[10px] font-medium tracking-wider uppercase">
            {t('chatPanel.channels')}
          </span>
          {channels.map((ch) => {
            const unread = unreadCounts.get(ch.index) ?? 0;
            const channelUnreadSuffix =
              unread > 0 && !(viewMode === 'channels' && channel === ch.index)
                ? ` ${unread > 99 ? '99+' : unread}`
                : '';
            return (
              <button
                key={ch.index}
                aria-label={`${ch.name}${channelUnreadSuffix}`}
                onClick={() => {
                  setChannel(ch.index);
                  setViewMode('channels');
                }}
                className={`relative shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'channels' && channel === ch.index
                    ? 'bg-readable-green text-white'
                    : 'bg-secondary-dark text-muted hover:text-gray-200'
                }`}
              >
                {ch.name}
                {unread > 0 && !(viewMode === 'channels' && channel === ch.index) && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-start gap-2 self-start">
          <ChatToolbarTooltipButton
            tooltip={t('chatPanel.jumpToDate')}
            aria-pressed={showDatePicker}
            aria-label={t('chatPanel.jumpToDate')}
            className={`shrink-0 rounded-lg p-1.5 transition-colors ${
              showDatePicker
                ? 'bg-brand-green/20 text-bright-green'
                : 'text-muted hover:text-gray-300'
            }`}
            onClick={() => {
              setShowDatePicker((v) => !v);
            }}
          >
            <Calendar aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
          </ChatToolbarTooltipButton>

          {protocol === 'meshtastic' &&
            isConnected &&
            !isMqttOnly &&
            onFetchStoreForwardHistory && (
              <ChatToolbarTooltipButton
                tooltip={t('chatPanel.fetchStoreForwardHistoryHint')}
                aria-label={t('chatPanel.fetchStoreForwardHistory')}
                onClick={() => {
                  void (async () => {
                    setChatActionError(null);
                    const result = await onFetchStoreForwardHistory();
                    if (!result.ok) {
                      setChatActionError({
                        message: t(`chatPanel.fetchStoreForwardHistoryError.${result.code}`),
                        viewKey,
                      });
                      return;
                    }
                    addToast(t('chatPanel.fetchStoreForwardHistorySent'), 'success');
                  })();
                }}
              >
                <Clock aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
              </ChatToolbarTooltipButton>
            )}

          <ChatToolbarTooltipButton
            tooltip={t('chatPanel.exportChat')}
            aria-label={t('chatPanel.exportChat')}
            onClick={() => {
              void (async () => {
                try {
                  const msgs: ChatExportMessage[] = filteredMessages.map((m) => ({
                    timestamp: m.timestamp,
                    sender_name: m.sender_name,
                    payload: m.payload,
                    channel: m.channel,
                    to: m.to,
                  }));
                  const result = await window.electronAPI.chat.export(msgs);
                  if (!result.success) {
                    setChatActionError({ message: t('chatPanel.exportChatFailed'), viewKey });
                  }
                } catch (e: unknown) {
                  console.warn('[ChatPanel] export failed ' + errLikeToLogString(e));
                  setChatActionError({ message: t('chatPanel.exportChatFailed'), viewKey });
                }
              })();
            }}
          >
            <Download aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
          </ChatToolbarTooltipButton>

          <ChatToolbarTooltipButton
            tooltip={t('chatPanel.searchMessages')}
            aria-pressed={showSearch}
            aria-label={t('chatPanel.searchMessages')}
            className={`shrink-0 rounded-lg p-1.5 transition-colors ${
              showSearch ? 'bg-brand-green/20 text-bright-green' : 'text-muted hover:text-gray-300'
            }`}
            onClick={() => {
              setShowSearch(!showSearch);
            }}
          >
            <Search aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
          </ChatToolbarTooltipButton>

          {viewMode !== 'starred' && (
            <ChatToolbarTooltipButton
              tooltip={
                mutedViews.has(viewKey)
                  ? t('chatPanel.unmuteConversation')
                  : t('chatPanel.muteConversation')
              }
              aria-pressed={mutedViews.has(viewKey)}
              aria-label={
                mutedViews.has(viewKey)
                  ? t('chatPanel.unmuteConversation')
                  : t('chatPanel.muteConversation')
              }
              className={`shrink-0 rounded-lg p-1.5 transition-colors ${
                mutedViews.has(viewKey)
                  ? 'text-amber-500 hover:text-amber-300'
                  : 'text-muted hover:text-gray-300'
              }`}
              onClick={() => {
                toggleMuteView(viewKey);
              }}
            >
              {mutedViews.has(viewKey) ? (
                <BellOff aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
              ) : (
                <Bell aria-hidden className="h-4 w-4" trigger={parentIconTrigger} size={16} />
              )}
            </ChatToolbarTooltipButton>
          )}

          <ChatToolbarTooltipButton
            tooltip={t('chatPanel.starredMessages')}
            aria-pressed={viewMode === 'starred'}
            aria-label={t('chatPanel.starredMessages')}
            className={`shrink-0 rounded-lg p-1.5 transition-colors ${
              viewMode === 'starred'
                ? 'bg-brand-green/20 text-amber-400'
                : 'text-muted hover:text-gray-300'
            }`}
            onClick={() => {
              setViewMode((v) => (v === 'starred' ? 'channels' : 'starred'));
            }}
          >
            <Star
              aria-hidden
              className={`h-4 w-4 ${viewMode === 'starred' ? 'fill-current' : ''}`}
              trigger={parentIconTrigger}
              size={16}
            />
          </ChatToolbarTooltipButton>
        </div>
      </div>

      {protocol === 'meshcore' && waitingMessagesCount > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-1.5 text-xs text-amber-200">
          <span>{t('chatPanel.waitingMessagesBadge', { count: waitingMessagesCount })}</span>
          {onSyncWaitingMessages && (
            <button
              type="button"
              onClick={onSyncWaitingMessages}
              className="rounded border border-amber-600/60 px-2 py-0.5 text-[10px] font-medium hover:bg-amber-800/40"
              aria-label={t('chatPanel.waitingMessagesSyncNow')}
            >
              {t('chatPanel.waitingMessagesSyncNow')}
            </button>
          )}
        </div>
      )}

      {/* Row 2 — DM tabs */}
      <div
        className={`mb-2 flex min-h-[28px] min-w-0 items-center gap-2 whitespace-nowrap ${viewMode === 'channels' ? 'opacity-50' : ''}`}
      >
        <span className="text-muted mr-1 shrink-0 text-[10px] font-medium tracking-wider uppercase">
          DMs
        </span>
        {visibleDmTabs.length === 0 ? (
          <span className="text-[10px] text-gray-600 italic">No conversations</span>
        ) : (
          visibleDmTabs.map((nodeNum) => {
            const dmUnread = dmUnreadCounts.get(nodeNum) ?? 0;
            const showDmUnreadBadge =
              dmUnread > 0 && !(viewMode === 'dm' && activeDmNode === nodeNum);
            return (
              <div
                key={nodeNum}
                className={`relative flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'dm' && activeDmNode === nodeNum
                    ? 'bg-purple-600 text-white'
                    : 'bg-secondary-dark text-muted hover:text-gray-200'
                }`}
              >
                <button
                  type="button"
                  aria-label={getDmLabel(nodeNum)}
                  className={`min-w-0 truncate rounded-full px-0 py-0 text-left font-medium transition-colors ${
                    viewMode === 'dm' && activeDmNode === nodeNum
                      ? 'text-white'
                      : 'text-muted hover:text-gray-200'
                  }`}
                  onClick={() => {
                    openDmTo(nodeNum);
                  }}
                >
                  {getDmLabel(nodeNum)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    toggleMuteView(`dm:${nodeNum}`);
                  }}
                  aria-label={
                    mutedViews.has(`dm:${nodeNum}`)
                      ? t('chatPanel.unmuteConversation')
                      : t('chatPanel.muteConversation')
                  }
                  className={`ml-0.5 text-[10px] leading-none transition-colors ${
                    mutedViews.has(`dm:${nodeNum}`)
                      ? 'text-amber-500 hover:text-amber-300'
                      : 'text-muted hover:text-white'
                  }`}
                  title={
                    mutedViews.has(`dm:${nodeNum}`)
                      ? t('chatPanel.unmuteConversation')
                      : t('chatPanel.muteConversation')
                  }
                >
                  {mutedViews.has(`dm:${nodeNum}`) ? (
                    <BellOff
                      aria-hidden
                      className="h-2.5 w-2.5"
                      trigger={parentIconTrigger}
                      size={10}
                    />
                  ) : (
                    <Bell
                      aria-hidden
                      className="h-2.5 w-2.5"
                      trigger={parentIconTrigger}
                      size={10}
                    />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeDmTab(nodeNum);
                  }}
                  aria-label={t('chatPanel.closeDmTab')}
                  className="text-muted ml-0.5 text-[10px] leading-none hover:text-white"
                  title={t('chatPanel.closeDm')}
                >
                  x
                </button>
                {showDmUnreadBadge && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {dmUnread > 99 ? '99+' : dmUnread}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="mb-2">
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
            className="bg-secondary-dark/80 focus:border-brand-green/50 w-full rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          />
          {searchQuery && (
            <div className="text-muted mt-1 text-xs">
              {t('chatPanel.searchResults', { count: filteredMessages.length })}
            </div>
          )}
        </div>
      )}

      {showDatePicker && (
        <div className="mb-2 flex items-center gap-2">
          <input
            type="date"
            value={jumpDate}
            max={new Date().toISOString().slice(0, 10)}
            aria-label={t('chatPanel.jumpToDate')}
            onChange={(e) => {
              setJumpDate(e.target.value);
              handleJumpToDate(e.target.value);
            }}
            className="bg-secondary-dark/80 focus:border-brand-green/50 rounded-lg border border-gray-600/50 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
          />
          {jumpDate && (
            <button
              type="button"
              onClick={() => {
                setJumpDate('');
              }}
              className="text-muted text-xs hover:text-gray-300"
              aria-label="Clear date"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Sender filter banner */}
      {filterSender != null && (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-blue-600/40 bg-blue-900/20 px-3 py-1.5 text-xs text-blue-300">
          <span>
            {t('chatPanel.filteringBySender', {
              name: nodes.get(filterSender)
                ? nodeDisplayName(nodes.get(filterSender), protocol ?? 'meshtastic')
                : `#${filterSender}`,
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              setFilterSender(null);
            }}
            aria-label={t('chatPanel.clearSenderFilter')}
            className="ml-2 hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* Disconnected overlay */}
      {!isConnected && (
        <div className="bg-deep-black/60 mb-2 rounded-xl border border-gray-700 p-4 text-center">
          <p className="text-muted text-sm">Not connected — messages are read-only</p>
        </div>
      )}

      {/* DM node info header */}
      {isDmMode &&
        activeDmNode != null &&
        (() => {
          const dmNode = nodes.get(activeDmNode);
          if (!dmNode) return null;
          return <DmPeerInfoBar dmNode={dmNode} nowMs={nowMs} t={t} />;
        })()}

      {/* Starred messages view */}
      {viewMode === 'starred' && (
        <div className="bg-deep-black/50 min-h-0 flex-1 overflow-y-auto rounded-xl p-3">
          {starred.length === 0 ? (
            <div className="text-muted py-12 text-center text-sm">
              {t('chatPanel.noStarredMessages')}
            </div>
          ) : (
            <div className="space-y-2">
              {[...starred]
                .sort((a, b) => b.starredAt - a.starredAt)
                .map((s) => {
                  const sourceLabel =
                    s.to != null ? `DM: ${s.sender_name || String(s.sender_id)}` : `ch${s.channel}`;
                  return (
                    <div
                      key={s.starId}
                      className="border-border/30 flex items-start gap-2 rounded-lg border bg-slate-800/40 p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-300">
                            {s.sender_name || String(s.sender_id)}
                          </span>
                          <span className="text-muted text-[10px]">
                            {formatFullTimestamp(s.timestamp)}
                          </span>
                          <span className="rounded bg-slate-700 px-1 py-0 text-[9px] text-gray-400">
                            {sourceLabel}
                          </span>
                        </div>
                        <p className="text-sm break-words text-gray-200">{s.payload}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          onClick={() => {
                            const [type, raw] = s.viewKey.split(':');
                            if (type === 'dm' && raw) {
                              openDmTo(Number(raw));
                            } else {
                              if (raw !== undefined) setChannel(Number(raw));
                              setViewMode('channels');
                            }
                          }}
                          {...{ [PARENT_HOVER_ATTR]: '' }}
                          className="rounded p-1 text-[10px] text-gray-500 hover:text-blue-400"
                          title={t('chatPanel.goToMessage')}
                          aria-label={t('chatPanel.goToMessage')}
                        >
                          <ExternalLink
                            aria-hidden
                            className="h-3 w-3"
                            trigger={parentIconTrigger}
                            size={12}
                          />
                        </button>
                        <button
                          onClick={() => {
                            setStarred((prev) => prev.filter((x) => x.starId !== s.starId));
                          }}
                          {...{ [PARENT_HOVER_ATTR]: '' }}
                          className="rounded p-1 text-[10px] text-amber-500 hover:text-amber-300"
                          title={t('chatPanel.unstarMessage')}
                          aria-label={t('chatPanel.unstarMessage')}
                        >
                          <Star
                            aria-hidden
                            className="h-3 w-3 fill-current"
                            trigger={parentIconTrigger}
                            size={12}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className={`relative min-h-0 flex-1 ${viewMode === 'starred' ? 'hidden' : ''}`}>
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="bg-deep-black/50 h-full overflow-y-auto overscroll-contain rounded-xl p-3 [overflow-anchor:none]"
        >
          {filteredMessages.length === 0 ? (
            <div className="text-muted py-12 text-center">
              {searchQuery
                ? t('chatPanel.emptyNoSearchMatches')
                : isDmMode
                  ? t('chatPanel.emptyNoDmMessages', { name: dmNodeName })
                  : isConnected
                    ? t('chatPanel.emptyNoMessagesYet')
                    : t('chatPanel.emptyConnectFirst')}
            </div>
          ) : (
            <div
              ref={messageVirtualizer.containerRef}
              className="relative w-full"
              style={{ height: `${messageVirtualizer.getTotalSize()}px` }}
            >
              {messageVirtualizer.getVirtualItems().map((vi) => {
                const i = vi.index;
                const msg = filteredMessages[i];
                if (!msg) return null;
                const isOwn = isOwnNode(msg.sender_id);
                const isDm = !!msg.to;
                const reactionRows = getReactionRows(msg.packetId ?? msg.timestamp);
                const messageRowKey = msg.packetId ?? msg.timestamp;
                const showPicker = pickerOpenFor === (msg.packetId ?? msg.timestamp);
                const pickerOpensAbove = i >= filteredMessages.length - 3;

                const senderNode = nodes.get(msg.sender_id);
                const displaySenderName =
                  nodeDisplayName(senderNode, protocol) ||
                  msg.sender_name.trim() ||
                  (msg.sender_id > 0 ? getDmLabel(msg.sender_id) : '');

                // Day separator
                const daySeparator = daySeparatorIndices.has(i) ? (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 border-t border-gray-700" />
                    <span className="text-muted shrink-0 text-xs font-medium">
                      {formatDayLabel(msg.timestamp, t)}
                    </span>
                    <div className="flex-1 border-t border-gray-700" />
                  </div>
                ) : null;

                const isUnreadStart = i === unreadStartIndex;

                const prevMsg = i > 0 ? filteredMessages[i - 1] : null;
                const nextMsg = i < filteredMessages.length - 1 ? filteredMessages[i + 1] : null;
                const isContinuation =
                  compactMode &&
                  daySeparator === null &&
                  prevMsg !== null &&
                  prevMsg.sender_id === msg.sender_id;
                const isFollowedByContinuation =
                  compactMode &&
                  nextMsg !== null &&
                  nextMsg.sender_id === msg.sender_id &&
                  !daySeparatorIndices.has(i + 1);
                const showContinuationTime =
                  isContinuation &&
                  prevMsg !== null &&
                  msg.timestamp - prevMsg.timestamp >= CHAT_COMPACT_CONTINUATION_TIME_GAP_MS;

                /** Visually merge compact consecutive same-sender bubbles (flat seam + no double border). */
                const compactMerged = compactMode && (isContinuation || isFollowedByContinuation);
                const compactStackTop = compactMode && isContinuation;
                const compactStackBottom = compactMode && isFollowedByContinuation;

                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={messageVirtualizer.measureElement}
                    className={`absolute top-0 left-0 w-full ${compactMode ? 'pb-0.5' : 'pb-1.5'}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div className={isContinuation ? '!mt-0' : undefined}>
                      {daySeparator}
                      {isUnreadStart && (
                        <div ref={attachUnreadDividerRef}>
                          <UnreadDivider />
                        </div>
                      )}
                      <div
                        className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                        data-chat-message-key={messageRowKey}
                        data-chat-day-key={getChatDayKey(msg.timestamp)}
                      >
                        {/* Bubble row */}
                        <div
                          className={`group/msg flex max-w-[80%] items-end gap-1 ${
                            isOwn ? 'flex-row-reverse' : 'flex-row'
                          }`}
                        >
                          {/* Message bubble */}
                          <div
                            className={`min-w-0 rounded-2xl px-3 ${compactMode ? 'py-1' : 'py-2'} ${
                              compactMerged
                                ? `${compactStackTop ? 'rounded-t-none border-t-0' : ''} ${compactStackBottom ? 'rounded-b-none border-b-0' : ''} ${
                                    isDm
                                      ? isOwn
                                        ? 'border border-purple-500/30 bg-purple-600/20'
                                        : 'border border-purple-600/30 bg-purple-700/20'
                                      : isOwn
                                        ? 'border border-blue-500/30 bg-blue-600/20'
                                        : 'border-chat-incoming-border bg-chat-incoming-bg border'
                                  }`
                                : isDm
                                  ? isOwn
                                    ? `${isFollowedByContinuation ? 'rounded-br-none' : 'rounded-br-sm'} border border-purple-500/30 bg-purple-600/20${isContinuation ? 'rounded-tr-sm' : ''}`
                                    : `${isFollowedByContinuation ? 'rounded-bl-none' : 'rounded-bl-sm'} border border-purple-600/30 bg-purple-700/20${isContinuation ? 'rounded-tl-sm' : ''}`
                                  : isOwn
                                    ? `${isFollowedByContinuation ? 'rounded-br-none' : 'rounded-br-sm'} border border-blue-500/30 bg-blue-600/20${isContinuation ? 'rounded-tr-sm' : ''}`
                                    : `${isFollowedByContinuation ? 'rounded-bl-none' : 'rounded-bl-sm'} border-chat-incoming-border border bg-chat-incoming-bg${isContinuation ? 'rounded-tl-sm' : ''}`
                            }`}
                          >
                            {/* Header: sender name (clickable) + DM indicator + time */}
                            {!isContinuation && (
                              <div className="mb-0.5 flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    onNodeClick(msg.sender_id);
                                  }}
                                  className={`cursor-pointer text-xs font-semibold hover:underline ${
                                    isDm
                                      ? 'text-purple-400'
                                      : isOwn
                                        ? 'text-blue-400'
                                        : filterSender === msg.sender_id
                                          ? 'text-blue-300 underline'
                                          : 'text-bright-green'
                                  }`}
                                  title={t('chatPanel.filterBySender')}
                                >
                                  {displaySenderName}
                                </button>
                                {!isOwn && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFilterSender((prev) =>
                                        prev === msg.sender_id ? null : msg.sender_id,
                                      );
                                    }}
                                    aria-label={t('chatPanel.filterBySender')}
                                    aria-pressed={filterSender === msg.sender_id}
                                    {...{ [PARENT_HOVER_ATTR]: '' }}
                                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] transition-colors ${
                                      filterSender === msg.sender_id
                                        ? 'bg-blue-700/40 text-blue-300'
                                        : 'text-gray-600 hover:text-blue-400'
                                    }`}
                                    title={t('chatPanel.filterBySender')}
                                  >
                                    <ListFilter
                                      aria-hidden
                                      className="h-2.5 w-2.5"
                                      trigger={parentIconTrigger}
                                      size={10}
                                    />
                                  </button>
                                )}
                                {isDm && (
                                  <span className="text-[10px] font-medium text-purple-400/70">
                                    DM
                                  </span>
                                )}
                                <span
                                  className="text-muted/70 text-[10px]"
                                  title={formatFullTimestamp(msg.timestamp)}
                                >
                                  {formatTime(msg.timestamp)}
                                </span>
                                {channels.length > 1 && !isDm && (
                                  <span className="text-[10px] text-gray-600">ch{msg.channel}</span>
                                )}
                              </div>
                            )}

                            {showContinuationTime && (
                              <div className={`mb-0.5 ${isOwn ? 'flex justify-end' : ''}`}>
                                <span
                                  className="text-muted/70 text-[10px]"
                                  title={formatFullTimestamp(msg.timestamp)}
                                >
                                  {formatTime(msg.timestamp)}
                                </span>
                              </div>
                            )}

                            {/* Quoted reply preview */}
                            {(msg.replyId != null ||
                              msg.replyPreviewSender != null ||
                              msg.replyPreviewText != null) &&
                              !msg.emoji &&
                              (() => {
                                const orig =
                                  msg.replyId != null
                                    ? protocol === 'meshtastic'
                                      ? findMeshtasticParentMessageForReply(
                                          viewMessages,
                                          msg.replyId,
                                          {
                                            replyPreviewSender: msg.replyPreviewSender,
                                            beforeTimestamp: msg.timestamp,
                                            channel: msg.channel,
                                            to: msg.to,
                                            excludeSenderId: msg.sender_id,
                                          },
                                        )
                                      : findMeshcoreParentMessageForReply(
                                          viewMessages,
                                          msg.replyId,
                                          {
                                            replyPreviewSender: msg.replyPreviewSender,
                                            beforeTimestamp: msg.timestamp,
                                            channel: msg.channel,
                                            to: msg.to,
                                            excludeSenderId: msg.sender_id,
                                          },
                                        )
                                    : undefined;
                                const quoteSnippet =
                                  orig != null
                                    ? truncateReplyPreviewText(orig.payload)
                                    : msg.replyPreviewText?.trim() || undefined;
                                const quotedLabel =
                                  orig != null
                                    ? nodeDisplayName(nodes.get(orig.sender_id), protocol) ||
                                      orig.sender_name
                                    : msg.replyPreviewSender?.trim() || undefined;
                                const canJumpToParent = msg.replyId != null && !!orig;
                                if (!quoteSnippet && !quotedLabel) return null;
                                const quoteClassName =
                                  'bg-secondary-dark/50 mb-1.5 flex w-full gap-1.5 rounded-lg border border-gray-600/50 px-2 py-1.5 text-left';
                                const quoteBody = (
                                  <>
                                    <div className="min-h-[2rem] w-0.5 shrink-0 self-stretch rounded-full bg-gray-500" />
                                    <div className="min-w-0 flex-1">
                                      <span className="block text-[10px] font-semibold text-gray-400">
                                        {quotedLabel}
                                      </span>
                                      {quoteSnippet ? (
                                        <span className="line-clamp-2 block text-[11px] break-words text-gray-500">
                                          {quoteSnippet}
                                        </span>
                                      ) : null}
                                    </div>
                                  </>
                                );
                                if (canJumpToParent) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        scrollToQuotedParent(msg.replyId!);
                                      }}
                                      className={`${quoteClassName} hover:bg-secondary-dark/80 transition-colors`}
                                      aria-label={t('chatPanel.jumpToQuotedMessage', {
                                        sender: quotedLabel ?? '',
                                      })}
                                    >
                                      {quoteBody}
                                    </button>
                                  );
                                }
                                return (
                                  <div
                                    className={quoteClassName}
                                    aria-label={
                                      quotedLabel
                                        ? t('chatPanel.jumpToQuotedMessage', {
                                            sender: quotedLabel,
                                          })
                                        : undefined
                                    }
                                  >
                                    {quoteBody}
                                  </div>
                                );
                              })()}

                            {/* Message text with optional search highlight (div: ChatPayloadText may render block link previews) */}
                            <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-gray-200">
                              <ChatPayloadText
                                text={msg.payload}
                                query={searchQuery}
                                loadLinkPreviews={!showScrollButton}
                                onContentResize={() => {
                                  scheduleMessageRowRemeasure(i);
                                }}
                              />
                            </div>

                            {/* Transport + RF hop count (incoming) */}
                            {!isOwn &&
                              (msg.receivedVia ||
                                msg.viaStoreForward ||
                                (msg.rxHops != null &&
                                  (msg.receivedVia === 'rf' || msg.receivedVia === 'both'))) && (
                                <div className="mt-0.5 flex items-center justify-end gap-2">
                                  {msg.rxHops != null &&
                                    (msg.receivedVia === 'rf' || msg.receivedVia === 'both') && (
                                      <span
                                        className="text-[10px] text-gray-500"
                                        title={t('nodeDetailModal.hopsFromRoutingTitle')}
                                      >
                                        {t('nodeDetailModal.hopLabel', { count: msg.rxHops })}
                                      </span>
                                    )}
                                  {msg.viaStoreForward && <StoreForwardBadge />}
                                  {msg.receivedVia && <TransportBadge via={msg.receivedVia} />}
                                </div>
                              )}

                            {/* Delivery status for own messages */}
                            {isOwn && (msg.status || msg.mqttStatus) && (
                              <div className="mt-0.5 flex items-center justify-end gap-1">
                                {isOwn && msg.status === 'failed' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onResend(msg);
                                    }}
                                    {...{ [PARENT_HOVER_ATTR]: '' }}
                                    className="text-gray-500 transition-colors hover:text-gray-300"
                                    title={t('chatPanel.resendMessage')}
                                  >
                                    <RotateCcw
                                      aria-hidden
                                      className="h-3.5 w-3.5"
                                      trigger={parentIconTrigger}
                                      size={14}
                                    />
                                  </button>
                                )}
                                {msg.mqttStatus ? (
                                  <>
                                    <MessageStatusBadge status={msg.mqttStatus} transport="mqtt" />
                                    {msg.status && (
                                      <MessageStatusBadge
                                        status={msg.status}
                                        transport="device"
                                        connectionType={connectionType}
                                        error={msg.error}
                                      />
                                    )}
                                  </>
                                ) : msg.status ? (
                                  <MessageStatusBadge
                                    status={msg.status}
                                    transport={isMqttOnly ? 'mqtt' : 'device'}
                                    connectionType={connectionType}
                                    error={msg.error}
                                  />
                                ) : null}
                              </div>
                            )}
                          </div>

                          {/* Inline reaction trigger — visible on hover or focus-within */}
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition-all group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
                            {/* Copy — always available */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void writeClipboardText(msg.payload).catch((err: unknown) => {
                                  console.warn('Failed to copy message:', errLikeToLogString(err));
                                });
                              }}
                              {...{ [PARENT_HOVER_ATTR]: '' }}
                              className="rounded p-1 text-xs text-gray-600 hover:text-green-400"
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
                            {isConnected && (
                              <>
                                <button
                                  onClick={() => {
                                    setReplyTo(msg);
                                    composerInputRef.current?.focus();
                                  }}
                                  {...{ [PARENT_HOVER_ATTR]: '' }}
                                  className="rounded p-1 text-xs text-gray-600 hover:text-blue-400"
                                  aria-label={t('chatPanel.replyToMessage')}
                                  title={t('chatPanel.replyButton')}
                                >
                                  <CornerUpLeft
                                    aria-hidden
                                    className="h-3.5 w-3.5"
                                    trigger={parentIconTrigger}
                                    size={14}
                                  />
                                </button>
                                {/* React */}
                                <button
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    if (!chatPanelIsLinux())
                                      reactionHiddenInputRef.current?.focus();
                                  }}
                                  onClick={() => {
                                    const id = msg.packetId ?? msg.timestamp;
                                    reactionPickerTarget.current = { id, channel: msg.channel };
                                    if (chatPanelIsLinux()) {
                                      setPickerOpenFor(showPicker ? null : id);
                                    } else {
                                      void window.electronAPI.showEmojiPanel();
                                    }
                                  }}
                                  {...{ [PARENT_HOVER_ATTR]: '' }}
                                  className="rounded p-1 text-xs text-gray-600 hover:text-gray-300"
                                  aria-label={t('chatPanel.addReaction')}
                                  title={t('chatPanel.reactButton')}
                                >
                                  <Smile
                                    aria-hidden
                                    className="h-3.5 w-3.5"
                                    trigger={parentIconTrigger}
                                    size={14}
                                  />
                                </button>
                                {/* Quick DM */}
                                {!isOwn && (
                                  <button
                                    onClick={() => {
                                      openDmTo(msg.sender_id);
                                    }}
                                    {...{ [PARENT_HOVER_ATTR]: '' }}
                                    className="rounded p-1 text-xs text-gray-600 hover:text-purple-400"
                                    title={t('chatPanel.directMessage', { name: msg.sender_name })}
                                  >
                                    <Mail
                                      aria-hidden
                                      className="h-3.5 w-3.5"
                                      trigger={parentIconTrigger}
                                      size={14}
                                    />
                                  </button>
                                )}
                                {/* Star message */}
                                {(() => {
                                  const starId = msgStarId(msg);
                                  const isStarred = starredIdSet.has(starId);
                                  return (
                                    <button
                                      onClick={() => {
                                        toggleStar(msg);
                                      }}
                                      {...{ [PARENT_HOVER_ATTR]: '' }}
                                      className={`rounded p-1 text-xs transition-colors ${
                                        isStarred
                                          ? 'text-amber-400 hover:text-amber-200'
                                          : 'text-gray-600 hover:text-amber-400'
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
                                  );
                                })()}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Reaction picker — Linux: emoji-picker-element; macOS/Windows: showEmojiPanel() */}
                        {showPicker && chatPanelIsLinux() && (
                          <div
                            className={`${pickerOpensAbove ? 'order-first mb-1' : 'mt-1'} ${isOwn ? 'self-end' : 'self-start'}`}
                          >
                            <emoji-picker ref={reactionPickerRef} style={{ width: '320px' }} />
                          </div>
                        )}

                        {/* Reaction badges */}
                        {reactionRows.length > 0 && (
                          <div
                            className={`mt-0.5 flex max-w-full flex-row flex-wrap gap-1 ${
                              isOwn ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {reactionRows.map((r, rIdx) => {
                              const hideReactorLabel = !isOwn && isOwnNode(r.sender_id);
                              const reactorLabel =
                                nodeDisplayName(nodes.get(r.sender_id), protocol) || r.sender_name;
                              const emojiChar = reactionDisplayGlyph(r.emoji, r.payload);
                              const reactionName = emojiDisplayLabel(r.emoji, r.payload);
                              const titleText = hideReactorLabel
                                ? `${reactionName} (you)`
                                : `${reactorLabel}: ${reactionName}`;
                              const ariaLabel = hideReactorLabel
                                ? `Your reaction: ${reactionName}`
                                : `${reactorLabel} reacted with ${reactionName}`;
                              return (
                                <span
                                  key={
                                    r.id != null
                                      ? `r-${r.id}`
                                      : `r-${r.sender_id}-${r.emoji}-${rIdx}`
                                  }
                                  className="bg-secondary-dark/80 inline-flex max-w-[min(100%,14rem)] cursor-default items-center gap-1 rounded-full border border-gray-600/50 px-1.5 py-0.5 text-xs"
                                  title={titleText}
                                  aria-label={ariaLabel}
                                >
                                  {!hideReactorLabel && (
                                    <span className="max-w-[5.5rem] truncate text-[10px] text-gray-400">
                                      {reactorLabel}
                                    </span>
                                  )}
                                  <span className="shrink-0">{emojiChar}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {viewOutboxRows.map((row) => (
            <OutboxBubble key={row.id} row={row} onRetry={retryOutbox} onCancel={cancelOutbox} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to unread / bottom button */}
        {showScrollButton && (
          <button
            onClick={() => {
              scrollToUnreadOrBottom();
            }}
            className="bg-secondary-dark absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 shadow-lg transition-all hover:bg-gray-600"
          >
            <ArrowDown aria-hidden className="h-3.5 w-3.5" trigger={parentIconTrigger} size={14} />
            {hasUnreadDivider ? t('chatPanel.jumpToUnread') : t('chatPanel.jumpToLatest')}
          </button>
        )}
      </div>

      {/* Hidden input: macOS/Windows native emoji panel inserts here for tapback reactions */}
      <input
        ref={reactionHiddenInputRef}
        aria-hidden="true"
        tabIndex={-1}
        readOnly={false}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
      />

      {/* Compose emoji picker — Linux only; macOS/Windows use native showEmojiPanel() */}
      <ChatComposer
        className="mt-1"
        protocol={protocol}
        viewKey={viewKey}
        isConnected={isConnected}
        connectionType={connectionType}
        isMqttOnly={isMqttOnly}
        isDmMode={isDmMode}
        composerContext={viewMode === 'dm' ? 'dm' : 'channel'}
        senderDisplayName={composerSelfDisplayName}
        placeholder={composePlaceholder}
        replyTo={replyTo}
        onReplyClear={() => {
          setReplyTo(null);
        }}
        mentionNodes={nodes}
        outboxChannel={channel}
        outboxDestination={viewMode === 'dm' && activeDmNode != null ? activeDmNode : undefined}
        queueOutbox={queueOutbox}
        onSendChunk={handleSendChunk}
        onSendSuccess={() => {
          setUnreadDividerTimestamp(0);
        }}
        textareaRef={composerInputRef}
      />

      {chatActionError?.viewKey === viewKey && (
        <div role="alert" className="mt-2 px-1 text-sm text-red-400">
          {chatActionError.message}
        </div>
      )}
    </div>
  );
}

export default memo(ChatPanel);
