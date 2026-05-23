/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import 'emoji-picker-element';

import type { TFunction } from 'i18next';
import {
  memo,
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
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import type { ChatExportMessage } from '@/shared/electron-api.types';
import { formatMeshtasticNodeId, isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

import type { OutboxEntry } from '../../shared/electron-api.types';
import { useChatOutbox } from '../hooks/useChatOutbox';
import { useNowMs } from '../hooks/useNowMs';
import {
  countMessageChars,
  getChatPayloadLimit,
  MAX_CHUNKS,
  splitChatMessage,
} from '../lib/chatComposerLimits';
import { playMessageNotification } from '../lib/chatNotifications';
import {
  clearDraft,
  dismissedDmTabsStorageKey,
  lastReadStorageKey,
  loadDraftsInitial,
  loadMutedViews,
  loadOpenDmTabsInitial,
  loadPersistedLastReadInitial,
  loadStarred,
  openDmTabsStorageKey,
  saveDraft,
  saveMutedViews,
  saveStarred,
  type StarredMessage,
} from '../lib/chatPanelProtocolStorage';
import { nodeDisplayName } from '../lib/nodeLongNameOrHex';
import { parseStoredJson } from '../lib/parseStoredJson';
import { emojiDisplayChar, emojiDisplayLabel } from '../lib/reactions';
import { truncateReplyPreviewText } from '../lib/replyPreview';
import { CHAT_COMPACT_CONTINUATION_TIME_GAP_MS } from '../lib/timeConstants';
import type { ChatMessage, MeshNode, MeshProtocol } from '../lib/types';
import { ChatPayloadText } from './ChatPayloadText';
import { HelpTooltip } from './HelpTooltip';
import MentionAutocomplete, { buildMentionCandidates } from './MentionAutocomplete';

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

function StatusBadge({
  status,
  transport,
  connectionType,
  error,
}: {
  status: 'sending' | 'acked' | 'failed' | 'queued' | 'blocked';
  transport: 'device' | 'mqtt' | 'outbox';
  connectionType?: 'ble' | 'serial' | 'http' | null;
  error?: string;
}) {
  if (status === 'queued') {
    return (
      <HelpTooltip text="Queued \u2014 will send when connected">
        <span className="text-muted text-[10px]">\u23F3 Queued</span>
      </HelpTooltip>
    );
  }
  if (status === 'blocked') {
    return (
      <HelpTooltip text={error ?? 'Blocked \u2014 no encryption key available'}>
        <span className="text-[10px] text-amber-400">\uD83D\uDD12 Blocked</span>
      </HelpTooltip>
    );
  }
  const icon =
    status === 'sending'
      ? '\u23F3'
      : status === 'acked'
        ? '\u2713'
        : transport === 'device'
          ? 'no ACK'
          : '\u2717';
  const colorClass =
    status === 'sending'
      ? 'text-muted'
      : status === 'acked'
        ? 'text-bright-green'
        : transport === 'device'
          ? 'text-yellow-400'
          : 'text-red-400';
  const label =
    transport === 'mqtt'
      ? 'MQTT'
      : connectionType === 'serial'
        ? 'USB'
        : connectionType === 'http'
          ? 'WiFi'
          : 'BT';
  const failedReason =
    status === 'failed' && transport === 'device'
      ? 'No ACK (message may still have been broadcast; no other node in range to acknowledge)'
      : error || 'Failed';
  const tooltip = `${transport === 'mqtt' ? 'MQTT' : 'Device'}: ${
    status === 'sending' ? 'Sending...' : status === 'acked' ? 'Delivered' : failedReason
  }`;
  return (
    <HelpTooltip text={tooltip}>
      <span className={`text-[10px] ${colorClass}`}>
        {label} {icon}
      </span>
    </HelpTooltip>
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
  const statusLabel =
    row.status === 'queued'
      ? 'Queued'
      : row.status === 'sending'
        ? 'Sending…'
        : row.status === 'blocked'
          ? 'Blocked'
          : 'Failed';
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
              aria-label="Retry outbox message"
              onClick={() => {
                onRetry(row.id);
              }}
              className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-slate-500"
            >
              Retry
            </button>
          )}
          <button
            aria-label="Cancel outbox message"
            onClick={() => {
              onCancel(row.id);
            }}
            className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-slate-500"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TransportBadge({ via }: { via: 'rf' | 'mqtt' | 'both' }) {
  const { t } = useTranslation();
  const rfIcon = (
    <svg
      className="h-3 w-3 text-blue-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{t('chatPanel.receivedViaRf')}</title>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
  const mqttIcon = (
    <svg
      className="h-3 w-3 text-purple-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{t('chatPanel.receivedViaMqtt')}</title>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );

  if (via === 'both') {
    return (
      <span
        className="flex flex-col items-center gap-px"
        title={t('chatPanel.receivedViaRfAndMqtt')}
      >
        {rfIcon}
        {mqttIcon}
      </span>
    );
  }
  return via === 'rf' ? rfIcon : mqttIcon;
}

function StoreForwardBadge() {
  const { t } = useTranslation();
  return (
    <svg
      className="h-3 w-3 text-amber-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{t('chatPanel.receivedViaStoreForward')}</title>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/** Format a date for day separators */
function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - msgDay.getTime();
  if (diff === 0) return 'Today';
  if (diff === 86_400_000) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Get a day key for grouping messages */
function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function UnreadDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-red-500/50" />
      <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-red-400 uppercase">
        New messages
      </span>
      <div className="flex-1 border-t border-red-500/50" />
    </div>
  );
}

function withoutDmNode(source: Record<number, number>, nodeNum: number): Record<number, number> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => Number(key) !== nodeNum));
}

function latestMessageTimestamp(messages: readonly ChatMessage[]): number {
  let latest = 0;
  for (const msg of messages) {
    if (msg.timestamp > latest) latest = msg.timestamp;
  }
  return latest;
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

/**
 * Distance from the “bottom” of the chat (latest messages). Uses the **maximum** of:
 * - Inner `overflow-y-auto` distance when the message list overflows, and
 * - Message-end sentinel vs `outerScrollRoot` (app main viewport), so we still
 *   detect “not at latest” when the inner scroller is at max but the shell scroll
 *   has moved the thread off-screen (or vice versa).
 */
export function getDistFromChatBottom(
  inner: HTMLDivElement | null,
  messagesEnd: HTMLDivElement | null,
  outerScrollRoot: HTMLElement | null,
): number | null {
  if (!inner) return null;

  let dist = 0;

  if (inner.scrollHeight > inner.clientHeight + 1) {
    dist = Math.max(dist, inner.scrollHeight - inner.scrollTop - inner.clientHeight);
  }

  if (outerScrollRoot && messagesEnd) {
    const rootRect = outerScrollRoot.getBoundingClientRect();
    const endRect = messagesEnd.getBoundingClientRect();
    dist = Math.max(dist, Math.max(0, endRect.bottom - rootRect.bottom));
  }

  return dist;
}

export interface ChatPanelProps {
  messages: ChatMessage[];
  channels: { index: number; name: string }[];
  myNodeNum: number;
  ownNodeIds?: number[];
  onSend: (
    text: string,
    channel: number,
    destination?: number,
    replyId?: number,
  ) => void | Promise<void>;
  onReact: (emoji: number, replyId: number, channel: number) => Promise<void>;
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
}

function ChatPanel({
  messages,
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
}: ChatPanelProps) {
  const { t } = useTranslation();
  const ownNodeIdSet = useMemo(() => {
    const base = ownNodeIds != null && ownNodeIds.length > 0 ? ownNodeIds : [myNodeNum];
    return new Set(base.filter((id) => id > 0));
  }, [myNodeNum, ownNodeIds]);

  const isOwnNode = useCallback((nodeId: number) => ownNodeIdSet.has(nodeId), [ownNodeIdSet]);

  /** DM peer for a message, excluding broadcast and non-DM traffic. */
  const resolveDmPeer = useCallback(
    (msg: ChatMessage): number | undefined => {
      if (msg.to == null) return undefined;
      let peer: number | undefined;
      if (isOwnNode(msg.sender_id) && !isOwnNode(msg.to)) peer = msg.to;
      else if (isOwnNode(msg.to) && !isOwnNode(msg.sender_id)) peer = msg.sender_id;
      if (peer == null) return undefined;
      if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
      return peer >>> 0;
    },
    [isOwnNode, protocol],
  );

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useImperativeHandle(scrollToTopRef, () => scrollToTop, [scrollToTop]);
  const [input, setInput] = useState('');
  const [channel, setChannel] = useState(() => (channels.length > 0 ? channels[0].index : 0));
  useEffect(() => {
    if (channels.length > 0 && !channels.some((c) => c.index === channel)) {
      setChannel(channels[0].index);
    }
  }, [channels, channel]);
  const [sending, setSending] = useState(false);
  const [chatActionError, setChatActionError] = useState<{
    message: string;
    viewKey: string;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [showComposePicker, setShowComposePicker] = useState(false);
  const isLinux = useMemo(() => window.electronAPI.getPlatform() === 'linux', []);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLElement | null>(null);
  const reactionPickerRef = useRef<HTMLElement | null>(null);
  const reactionPickerTarget = useRef<{ id: number; channel: number } | null>(null);
  const reactionHiddenInputRef = useRef<HTMLInputElement | null>(null);

  const handleReactRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Feature: draft persistence — always reflect latest input/viewKey in refs used by effects
  const inputValueRef = useRef(input);
  inputValueRef.current = input;

  // Feature: sender filter
  const [filterSender, setFilterSender] = useState<number | null>(null);

  // Feature: jump to date
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [jumpDate, setJumpDate] = useState('');

  const prevMessagesLengthRef = useRef(messages.length);

  // Feature: @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(0);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);

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

  // Ref to divider DOM node for scrollIntoView
  const unreadDividerRef = useRef<HTMLDivElement>(null);

  // Persist lastRead timestamps to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(lastReadStorageKey(protocol), JSON.stringify(persistedLastRead));
    } catch (e) {
      console.warn('[ChatPanel] persist lastRead failed ' + errLikeToLogString(e));
    }
  }, [persistedLastRead, protocol]);

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

  // Separate regular messages from reaction messages
  const { regularMessages, reactionsByReplyId } = useMemo(() => {
    const regular: ChatMessage[] = [];
    const reactions = new Map<
      number,
      { emoji: number; sender_id: number; sender_name: string; id?: number }[]
    >();

    for (const msg of messages) {
      if (msg.emoji && msg.replyId) {
        const existing = reactions.get(msg.replyId) ?? [];
        existing.push({
          emoji: msg.emoji,
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
  }, [messages]);

  const inferredDmTabs = useMemo(() => {
    const peers = new Map<number, number>();
    for (const msg of regularMessages) {
      const peer = resolveDmPeer(msg);
      if (peer == null) continue;
      peers.set(peer, (peers.get(peer) ?? 0) + 1);
    }
    return peers;
  }, [regularMessages, resolveDmPeer]);

  const visibleDmTabs = useMemo(() => {
    const all = new Set(openDmTabs);
    for (const [nodeNum, dmCount] of inferredDmTabs) {
      const dismissedCount = dismissedDmTabs[nodeNum] ?? 0;
      if (dmCount > dismissedCount) {
        all.add(nodeNum);
      }
    }
    return Array.from(all).filter(
      (nodeNum) => protocol !== 'meshtastic' || !isMeshtasticBroadcastNodeNum(nodeNum),
    );
  }, [openDmTabs, inferredDmTabs, dismissedDmTabs, protocol]);

  const inferredDmTabSet = useMemo(() => new Set(inferredDmTabs.keys()), [inferredDmTabs]);

  /** Incoming DM messages per peer newer than persisted last-read for `dm:${peer}` (channel unread map skips DMs). */
  const dmUnreadCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const msg of regularMessages) {
      if (msg.isHistory) continue;
      const peer = resolveDmPeer(msg);
      if (peer == null) continue;
      if (isOwnNode(msg.sender_id)) continue;
      const lr = persistedLastRead[`dm:${peer}`] ?? 0;
      if (msg.timestamp > lr) {
        counts.set(peer, (counts.get(peer) ?? 0) + 1);
      }
    }
    return counts;
  }, [isOwnNode, persistedLastRead, regularMessages, resolveDmPeer]);

  // Lookup map for rendering quoted replies (packetId in Meshtastic, timestamp fallback in MeshCore)
  const messageByReplyKey = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    for (const msg of regularMessages) {
      if (msg.packetId != null) map.set(msg.packetId, msg);
      map.set(msg.timestamp, msg);
    }
    return map;
  }, [regularMessages]);

  const unreadCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const msg of regularMessages) {
      if (isOwnNode(msg.sender_id)) continue; // own messages don't count
      if (msg.to) continue; // DMs don't contribute to channel unread counts
      if (msg.isHistory) continue; // history rehydration must not create fresh unread badges
      const lastRead = persistedLastRead[`ch:${msg.channel}`] ?? 0;
      if (msg.timestamp > lastRead) {
        counts.set(msg.channel, (counts.get(msg.channel) ?? 0) + 1);
      }
    }
    return counts;
  }, [isOwnNode, persistedLastRead, regularMessages]);

  const viewMessages = useMemo(() => {
    if (viewMode === 'dm' && activeDmNode != null) {
      return regularMessages.filter(
        (m) =>
          (m.to === activeDmNode && isOwnNode(m.sender_id)) ||
          (m.sender_id === activeDmNode && m.to != null && isOwnNode(m.to)),
      );
    }

    return regularMessages.filter((m) => !m.to && m.channel === channel);
  }, [activeDmNode, channel, isOwnNode, regularMessages, viewMode]);

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

  const viewKey = useMemo(() => {
    if (viewMode === 'dm' && activeDmNode != null) return `dm:${activeDmNode}`;
    return `ch:${channel}`;
  }, [viewMode, activeDmNode, channel]);

  // null = too many chunks (blocked); [] = fits in one; [..] = multi-part
  const inputChunks = useMemo(() => splitChatMessage(input.trim(), protocol), [input, protocol]);

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

  useEffect(() => {
    if (!isActive) return;
    markCurrentViewRead();
  }, [isActive, markCurrentViewRead]);

  // Draft persistence: save/restore unsent input when view changes (also loads on initial mount)
  const prevViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prevKey = prevViewKeyRef.current;
    if (prevKey !== null && prevKey !== viewKey) {
      const currentInput = inputValueRef.current;
      if (currentInput.trim()) {
        saveDraft(protocol, prevKey, currentInput);
      } else {
        clearDraft(protocol, prevKey);
      }
    }
    prevViewKeyRef.current = viewKey;
    const drafts = loadDraftsInitial(protocol);
    setInput(drafts[viewKey] ?? '');
    setMentionQuery(null);
    setFilterSender(null);
  }, [viewKey, protocol]);

  // Persist per-conversation mute
  useEffect(() => {
    saveMutedViews(protocol, mutedViews);
  }, [protocol, mutedViews]);

  // Persist starred messages
  useEffect(() => {
    saveStarred(protocol, starred);
  }, [protocol, starred]);

  // Sound notification: plays when a new message arrives and the user isn't actively reading it.
  useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (localStorage.getItem('mesh-client:notifMuted') === '1' || messages.length <= prevLen)
      return;
    const newMsgs = messages.slice(prevLen);
    for (const msg of newMsgs) {
      if (isOwnNode(msg.sender_id)) continue;
      if (msg.isHistory) continue;
      const peer = resolveDmPeer(msg);
      const msgViewKey = peer != null ? `dm:${peer}` : `ch:${msg.channel}`;
      if (mutedViews.has(msgViewKey)) continue;
      if ((!isActive || msgViewKey !== viewKey) && !document.hidden) {
        playMessageNotification();
        break;
      }
    }
  }, [messages, isActive, mutedViews, viewKey, isOwnNode, resolveDmPeer]);

  const updateScrollButtonVisibility = useCallback(() => {
    const distFromBottom = getDistFromChatBottom(
      scrollContainerRef.current,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (distFromBottom == null) return undefined;
    setShowScrollButton(distFromBottom > 200);
    return distFromBottom;
  }, [outerScrollMetricsRootRef]);

  const applyNearBottomReadState = useCallback(
    (distFromBottom: number) => {
      if (distFromBottom < 50) {
        markCurrentViewRead();
        setUnreadDividerTimestamp(0); // hide divider once user has read to bottom
      }
    },
    [markCurrentViewRead],
  );

  // Scroll tracking for scroll-to-bottom button + mark-as-read when at bottom
  const handleScroll = useCallback(() => {
    const distFromBottom = updateScrollButtonVisibility();
    if (distFromBottom === undefined) return;
    applyNearBottomReadState(distFromBottom);
  }, [applyNearBottomReadState, updateScrollButtonVisibility]);

  // Initialize scroll button visibility on mount — critical for async message loading (e.g., meshcore SQLite load)
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [updateScrollButtonVisibility]);

  // Auto-scroll on new messages (only if near bottom)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = getDistFromChatBottom(
      el,
      messagesEndRef.current,
      outerScrollMetricsRootRef?.current ?? null,
    );
    if (distFromBottom != null && distFromBottom < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      if (dist !== undefined) applyNearBottomReadState(dist);
    });
  }, [
    filteredMessages.length,
    outerScrollMetricsRootRef,
    updateScrollButtonVisibility,
    applyNearBottomReadState,
  ]);

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

  // Fires after view switch (triggerScrollToUnread increments). useLayoutEffect
  // ensures DOM is committed before scrolling, preventing flash of wrong position.
  useLayoutEffect(() => {
    if (triggerScrollToUnread === 0) return; // skip initial mount
    if (!isActive) return; // skip while hidden
    if (unreadDividerRef.current) {
      unreadDividerRef.current.scrollIntoView({ block: 'center' });
    } else {
      messagesEndRef.current?.scrollIntoView();
    }
    requestAnimationFrame(() => {
      const dist = updateScrollButtonVisibility();
      // When unread messages fit without scrolling, handleScroll never fires, so
      // check here and clear the divider if the user is already at the bottom.
      if (dist !== undefined && dist < 50) setUnreadDividerTimestamp(0);
    });
  }, [triggerScrollToUnread, isActive, updateScrollButtonVisibility]);

  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      updateScrollButtonVisibility();
    });
  }, [isActive, viewKey, updateScrollButtonVisibility]);

  const scrollToUnreadOrBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (unreadDividerRef.current) {
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
      unreadDividerRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [applyNearBottomReadState, outerScrollMetricsRootRef]);

  const scrollToQuotedParent = useCallback((replyKey: number) => {
    const root = scrollContainerRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-chat-message-key="${replyKey}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpenFor(null);
        setShowComposePicker(false);
        if (mentionQuery != null) {
          setMentionQuery(null);
        } else if (replyTo) {
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
  }, [showSearch, viewMode, replyTo, mentionQuery, filterSender, showDatePicker]);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const chunks = splitChatMessage(input.trim(), protocol);
    if (chunks === null) return; // >MAX_CHUNKS, send button should already be disabled

    const sendChannel = channel;
    const destination = viewMode === 'dm' && activeDmNode != null ? activeDmNode : undefined;
    const replyKey = replyTo ? (replyTo.packetId ?? replyTo.timestamp) : undefined;
    const textsToSend = chunks.length === 0 ? [input.trim()] : chunks;

    // Queue when: truly disconnected, OR MeshCore + MQTT-only (no device = packet-analyzer risk)
    if (!isConnected || (isMqttOnly && protocol === 'meshcore')) {
      const now = Date.now();
      const groupId = textsToSend.length > 1 ? crypto.randomUUID() : null;
      for (let i = 0; i < textsToSend.length; i++) {
        await queueOutbox({
          protocol,
          viewKey,
          channel: sendChannel,
          toNode: destination ?? null,
          payload: textsToSend[i],
          replyId: i === 0 ? (replyKey ?? null) : null,
          status: 'queued',
          error: null,
          nextRetryAt: null,
          createdAt: now + i,
          groupId,
          groupIndex: groupId ? i : null,
          groupTotal: groupId ? textsToSend.length : null,
        });
      }
      setInput('');
      clearDraft(protocol, viewKey);
      setMentionQuery(null);
      setReplyTo(null);
      return;
    }

    setSending(true);
    setChatActionError(null);
    try {
      console.debug('[ChatPanel] handleSend');
      // Chunked send: first chunk carries the replyId; subsequent chunks do not
      for (let i = 0; i < textsToSend.length; i++) {
        const sendOutcome = onSend(
          textsToSend[i],
          sendChannel,
          destination,
          i === 0 ? replyKey : undefined,
        );
        await Promise.resolve(sendOutcome);
      }
      setInput('');
      clearDraft(protocol, viewKey);
      setMentionQuery(null);
      setReplyTo(null);
      const now = Date.now();
      setPersistedLastRead((prev) => ({ ...prev, [viewKey]: now }));
      setUnreadDividerTimestamp(0);
    } catch (err) {
      console.error('[ChatPanel] Send failed: ' + errLikeToLogString(err));
      setChatActionError({
        message: err instanceof Error ? err.message : 'Send failed',
        viewKey,
      });
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (emojiCode: number, packetId: number, msgChannel: number) => {
    // Match handleSend: UI uses channel -1 as "primary"; MeshCore/Meshtastic send expects 0.
    const sendChannel = msgChannel === -1 ? 0 : msgChannel;
    setPickerOpenFor(null);
    setChatActionError(null);
    try {
      console.debug('[ChatPanel] handleReact', emojiCode, packetId, sendChannel);
      await onReact(emojiCode, packetId, sendChannel);
    } catch (err) {
      console.error('[ChatPanel] React failed: ' + errLikeToLogString(err));
      setChatActionError({
        message: err instanceof Error ? err.message : 'Reaction failed',
        viewKey,
      });
    }
  };
  handleReactRef.current = handleReact;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery != null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIdx((i) => Math.min(i + 1, mentionCandidates.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const candidate = mentionCandidates[mentionSelectedIdx];
        if (candidate) insertMention(candidate.name);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

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
    return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
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
      const dayKey = getDayKey(filteredMessages[i].timestamp);
      if (dayKey !== prevDayKey) {
        indices.add(i);
        prevDayKey = dayKey;
      }
    }
    return indices;
  }, [filteredMessages]);

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

  useEffect(() => {
    const el = emojiPickerRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const unicode: string = (e as CustomEvent).detail.emoji.unicode;
      const textarea = inputRef.current;
      const currentValue = textarea?.value ?? '';
      const start = textarea?.selectionStart ?? currentValue.length;
      const end = textarea?.selectionEnd ?? currentValue.length;
      const newVal = currentValue.slice(0, start) + unicode + currentValue.slice(end);
      if (newVal.length > 228) return;
      setInput(newVal);
      setShowComposePicker(false);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + unicode.length, start + unicode.length);
      });
    };
    el.addEventListener('emoji-click', handler);
    return () => {
      el.removeEventListener('emoji-click', handler);
    };
  }, [showComposePicker]);

  // Linux reaction picker — attach emoji-click on the <emoji-picker> web component
  useEffect(() => {
    if (!pickerOpenFor) return;
    const el = reactionPickerRef.current;
    if (!el) return;
    const target = reactionPickerTarget.current;
    if (!target) return;
    const handler = (e: Event) => {
      const unicode = (e as CustomEvent).detail.emoji.unicode as string;
      const code = unicode.codePointAt(0);
      if (code !== undefined) {
        void handleReactRef.current(code, target.id, target.channel);
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
      const code = unicode.codePointAt(0);
      const target = reactionPickerTarget.current;
      if (code !== undefined && target) {
        void handleReactRef.current(code, target.id, target.channel);
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
  // @mention autocomplete candidates
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const mentionCandidates = useMemo(
    () =>
      mentionQuery != null
        ? buildMentionCandidates(nodes, protocol ?? 'meshtastic', mentionQuery)
        : [],
    [mentionQuery, nodes, protocol],
  );

  const insertMention = useCallback(
    (name: string) => {
      const textarea = inputRef.current;
      const currentInput = inputValueRef.current;
      const insert = `@[${name}] `;
      const before = currentInput.slice(0, mentionTriggerPos);
      const after = currentInput.slice(mentionTriggerPos + (mentionQuery?.length ?? 0) + 1);
      const newVal = before + insert + after;
      if (newVal.length > 228) return;
      setInput(newVal);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        const newCursor = mentionTriggerPos + insert.length;
        textarea?.focus();
        textarea?.setSelectionRange(newCursor, newCursor);
      });
    },
    [mentionTriggerPos, mentionQuery],
  );

  // Jump to date — scroll to first message with matching day key
  const handleJumpToDate = useCallback((dateStr: string) => {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetKey = `${y}-${m - 1}-${d}`;
    const root = scrollContainerRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-chat-day-key="${targetKey}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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
      {/* Row 1 — Channel selector + Search toggle */}
      <div
        className={`mb-1 flex min-w-0 items-center gap-2 ${viewMode === 'dm' ? 'opacity-50' : ''}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
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
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Jump-to-date toggle */}
        <button
          onClick={() => {
            setShowDatePicker((v) => !v);
          }}
          aria-pressed={showDatePicker}
          aria-label={t('chatPanel.jumpToDate')}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            showDatePicker
              ? 'bg-brand-green/20 text-bright-green'
              : 'text-muted hover:text-gray-300'
          }`}
          title={t('chatPanel.jumpToDate')}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>

        {/* Export chat */}
        <button
          onClick={async () => {
            const msgs: ChatExportMessage[] = filteredMessages.map((m) => ({
              timestamp: m.timestamp,
              sender_name: m.sender_name,
              payload: m.payload,
              channel: m.channel,
              to: m.to,
            }));
            const result = await window.electronAPI.chat.export(msgs);
            if (!result.success)
              setChatActionError({ message: t('chatPanel.exportChatFailed'), viewKey });
          }}
          aria-label={t('chatPanel.exportChat')}
          className="text-muted shrink-0 rounded-lg p-1.5 transition-colors hover:text-gray-300"
          title={t('chatPanel.exportChat')}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </button>

        {/* Search toggle */}
        <button
          onClick={() => {
            setShowSearch(!showSearch);
          }}
          aria-pressed={showSearch}
          aria-label={t('chatPanel.searchMessages')}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            showSearch ? 'bg-brand-green/20 text-bright-green' : 'text-muted hover:text-gray-300'
          }`}
          title={t('chatPanel.searchButton')}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>

        {/* Per-conversation mute toggle — mutes the currently viewed channel or DM */}
        {viewMode !== 'starred' && (
          <button
            onClick={() => {
              toggleMuteView(viewKey);
            }}
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
            title={
              mutedViews.has(viewKey)
                ? t('chatPanel.unmuteConversation')
                : t('chatPanel.muteConversation')
            }
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              {mutedViews.has(viewKey) ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.73 21a2 2 0 01-3.46 0M18.63 13A17.89 17.89 0 0118 8M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h10.5m3.5-9a6 6 0 00-9.33-5M3 3l18 18"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              )}
            </svg>
          </button>
        )}

        {/* Starred messages toggle */}
        <button
          onClick={() => {
            setViewMode((v) => (v === 'starred' ? 'channels' : 'starred'));
          }}
          aria-pressed={viewMode === 'starred'}
          aria-label={t('chatPanel.starredMessages')}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            viewMode === 'starred'
              ? 'bg-brand-green/20 text-amber-400'
              : 'text-muted hover:text-gray-300'
          }`}
          title={t('chatPanel.starredMessages')}
        >
          <svg
            className="h-4 w-4"
            fill={viewMode === 'starred' ? 'currentColor' : 'none'}
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        </button>
      </div>

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
                    setActiveDmNode(nodeNum);
                    setViewMode('dm');
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
                  <svg
                    className="h-2.5 w-2.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    {mutedViews.has(`dm:${nodeNum}`) ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.73 21a2 2 0 01-3.46 0M18.63 13A17.89 17.89 0 0118 8M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h10.5m3.5-9a6 6 0 00-9.33-5M3 3l18 18"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                      />
                    )}
                  </svg>
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
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
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
                          className="rounded p-1 text-[10px] text-gray-500 hover:text-blue-400"
                          title={t('chatPanel.goToMessage')}
                          aria-label={t('chatPanel.goToMessage')}
                        >
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setStarred((prev) => prev.filter((x) => x.starId !== s.starId));
                          }}
                          className="rounded p-1 text-[10px] text-amber-500 hover:text-amber-300"
                          title={t('chatPanel.unstarMessage')}
                          aria-label={t('chatPanel.unstarMessage')}
                        >
                          <svg
                            className="h-3 w-3"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                            />
                          </svg>
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
          className={`bg-deep-black/50 h-full overflow-y-auto rounded-xl p-3 ${compactMode ? 'space-y-0.5' : 'space-y-1.5'}`}
        >
          {filteredMessages.length === 0 ? (
            <div className="text-muted py-12 text-center">
              {searchQuery
                ? 'No messages match your search.'
                : isDmMode
                  ? `No messages with ${dmNodeName} yet.`
                  : isConnected
                    ? 'No messages yet. Send one or wait for incoming messages.'
                    : 'Connect to a device to start chatting.'}
            </div>
          ) : (
            filteredMessages.map((msg, i) => {
              const isOwn = isOwnNode(msg.sender_id);
              const isDm = !!msg.to;
              const reactionRows = getReactionRows(msg.packetId ?? msg.timestamp);
              const messageRowKey = msg.packetId ?? msg.timestamp;
              const showPicker = pickerOpenFor === (msg.packetId ?? msg.timestamp);
              const pickerOpensAbove = i >= filteredMessages.length - 3;

              const senderNode = nodes.get(msg.sender_id);
              const displaySenderName = nodeDisplayName(senderNode, protocol) || msg.sender_name;

              // Day separator
              const daySeparator = daySeparatorIndices.has(i) ? (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 border-t border-gray-700" />
                  <span className="text-muted shrink-0 text-xs font-medium">
                    {formatDayLabel(msg.timestamp)}
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
                  key={
                    msg.id != null ? `db-${msg.id}` : `${msg.timestamp}-${msg.packetId ?? 'x'}-${i}`
                  }
                  className={isContinuation ? '!mt-0' : undefined}
                >
                  {daySeparator}
                  {isUnreadStart && (
                    <div ref={unreadDividerRef}>
                      <UnreadDivider />
                    </div>
                  )}
                  <div
                    className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                    data-chat-message-key={messageRowKey}
                    data-chat-day-key={getDayKey(msg.timestamp)}
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
                                className={`shrink-0 rounded px-1 py-0.5 text-[9px] transition-colors ${
                                  filterSender === msg.sender_id
                                    ? 'bg-blue-700/40 text-blue-300'
                                    : 'text-gray-600 hover:text-blue-400'
                                }`}
                                title={t('chatPanel.filterBySender')}
                              >
                                <svg
                                  className="h-2.5 w-2.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z"
                                  />
                                </svg>
                              </button>
                            )}
                            {isDm && (
                              <span className="text-[10px] font-medium text-purple-400/70">DM</span>
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
                        {msg.replyId &&
                          !msg.emoji &&
                          (() => {
                            const orig = messageByReplyKey.get(msg.replyId);
                            const quoteSnippet = orig
                              ? truncateReplyPreviewText(orig.payload)
                              : msg.replyPreviewText;
                            const quotedLabel = orig
                              ? nodeDisplayName(nodes.get(orig.sender_id), protocol) ||
                                orig.sender_name
                              : msg.replyPreviewSender;
                            if (!quoteSnippet && !quotedLabel) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToQuotedParent(msg.replyId!);
                                }}
                                className="bg-secondary-dark/50 hover:bg-secondary-dark/80 mb-1.5 flex w-full gap-1.5 rounded-lg border border-gray-600/50 px-2 py-1.5 text-left transition-colors"
                                aria-label={t('chatPanel.jumpToQuotedMessage', {
                                  sender: quotedLabel ?? '',
                                })}
                              >
                                <div className="min-h-[2rem] w-0.5 shrink-0 self-stretch rounded-full bg-gray-500" />
                                <div className="min-w-0 flex-1">
                                  <span className="block text-[10px] font-semibold text-gray-400">
                                    {quotedLabel}
                                  </span>
                                  <span className="line-clamp-2 block text-[11px] break-words text-gray-500">
                                    {quoteSnippet}
                                  </span>
                                </div>
                              </button>
                            );
                          })()}

                        {/* Message text with optional search highlight (div: ChatPayloadText may render block link previews) */}
                        <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-gray-200">
                          <ChatPayloadText text={msg.payload} query={searchQuery} />
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
                                className="text-gray-500 transition-colors hover:text-gray-300"
                                title={t('chatPanel.resendMessage')}
                              >
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={2}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                  />
                                </svg>
                              </button>
                            )}
                            {msg.mqttStatus ? (
                              <>
                                <StatusBadge status={msg.mqttStatus} transport="mqtt" />
                                {msg.status && (
                                  <StatusBadge
                                    status={msg.status}
                                    transport="device"
                                    connectionType={connectionType}
                                    error={msg.error}
                                  />
                                )}
                              </>
                            ) : msg.status ? (
                              <StatusBadge
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
                          className="rounded p-1 text-xs text-gray-600 hover:text-green-400"
                          aria-label={t('chatPanel.copyMessage')}
                          title={t('chatPanel.copyMessage')}
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        </button>
                        {isConnected && (
                          <>
                            <button
                              onClick={() => {
                                setReplyTo(msg);
                                inputRef.current?.focus();
                              }}
                              className="rounded p-1 text-xs text-gray-600 hover:text-blue-400"
                              aria-label={t('chatPanel.replyToMessage')}
                              title={t('chatPanel.replyButton')}
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
                                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                                />
                              </svg>
                            </button>
                            {/* React */}
                            <button
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (!isLinux) reactionHiddenInputRef.current?.focus();
                              }}
                              onClick={() => {
                                const id = msg.packetId ?? msg.timestamp;
                                reactionPickerTarget.current = { id, channel: msg.channel };
                                if (isLinux) {
                                  setPickerOpenFor(showPicker ? null : id);
                                } else {
                                  void window.electronAPI.showEmojiPanel();
                                }
                              }}
                              className="rounded p-1 text-xs text-gray-600 hover:text-gray-300"
                              aria-label={t('chatPanel.addReaction')}
                              title={t('chatPanel.reactButton')}
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
                                  d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </button>
                            {/* Quick DM */}
                            {!isOwn && (
                              <button
                                onClick={() => {
                                  openDmTo(msg.sender_id);
                                }}
                                className="rounded p-1 text-xs text-gray-600 hover:text-purple-400"
                                title={t('chatPanel.directMessage', { name: msg.sender_name })}
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
                                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                  />
                                </svg>
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
                                  <svg
                                    className="h-3.5 w-3.5"
                                    fill={isStarred ? 'currentColor' : 'none'}
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                                    />
                                  </svg>
                                </button>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Reaction picker — Linux: emoji-picker-element; macOS/Windows: showEmojiPanel() */}
                    {showPicker && isLinux && (
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
                          const emojiChar = emojiDisplayChar(r.emoji);
                          const reactionName = emojiDisplayLabel(r.emoji);
                          const titleText = hideReactorLabel
                            ? `${reactionName} (you)`
                            : `${reactorLabel}: ${reactionName}`;
                          const ariaLabel = hideReactorLabel
                            ? `Your reaction: ${reactionName}`
                            : `${reactorLabel} reacted with ${reactionName}`;
                          return (
                            <span
                              key={
                                r.id != null ? `r-${r.id}` : `r-${r.sender_id}-${r.emoji}-${rIdx}`
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
              );
            })
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
              if (unreadDividerRef.current) {
                scrollToUnreadOrBottom();
              } else {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="bg-secondary-dark absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-300 shadow-lg transition-all hover:bg-gray-600"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            {unreadDividerRef.current ? 'Jump to Unread' : 'Jump to Latest'}
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
      {isLinux && showComposePicker && (
        <emoji-picker
          ref={emojiPickerRef}
          style={{ width: '100%', maxWidth: '350px', alignSelf: 'flex-start' }}
        />
      )}

      {/* Reply preview bar */}
      {replyTo && (
        <div className="bg-secondary-dark/80 mb-1 flex items-center gap-2 rounded-xl border border-gray-600/50 px-3 py-1.5 text-xs">
          <svg
            className="h-3 w-3 shrink-0 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
            />
          </svg>
          <span className="text-gray-400">
            Replying to{' '}
            <span className="font-medium text-gray-200">
              {nodeDisplayName(nodes.get(replyTo.sender_id), protocol) || replyTo.sender_name}
            </span>
            :
          </span>
          <span className="flex-1 truncate text-gray-500">
            {replyTo.payload.length > 60 ? replyTo.payload.slice(0, 60) + '…' : replyTo.payload}
          </span>
          <button
            onClick={() => {
              setReplyTo(null);
            }}
            className="text-muted ml-1 leading-none hover:text-gray-200"
            title={t('chatPanel.cancelReply')}
          >
            ×
          </button>
        </div>
      )}

      {chatActionError?.viewKey === viewKey && (
        <div role="alert" className="mt-2 px-1 text-sm text-red-400">
          {chatActionError.message}
        </div>
      )}

      {/* Input area — textarea so Chromium applies spellcheck (single-line inputs often skip it) */}
      <div className="mt-1 flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          {mentionQuery != null && mentionCandidates.length > 0 && (
            <MentionAutocomplete
              candidates={mentionCandidates}
              selectedIdx={mentionSelectedIdx}
              onSelect={insertMention}
              onSetSelectedIdx={setMentionSelectedIdx}
            />
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              setChatActionError(null);
              // Detect @ trigger from end of current value (works reliably in all environments)
              const match = /@(\w*)$/.exec(val);
              if (match) {
                setMentionQuery(match[1]);
                setMentionTriggerPos(val.length - match[0].length);
                setMentionSelectedIdx(0);
              } else {
                setMentionQuery(null);
              }
            }}
            onKeyDown={handleKeyDown}
            spellCheck
            lang={
              typeof navigator !== 'undefined' && navigator.language
                ? navigator.language
                : undefined
            }
            enterKeyHint="send"
            placeholder={composePlaceholder}
            aria-label={composePlaceholder}
            className={`max-h-32 min-h-[42px] w-full resize-none overflow-y-auto rounded-xl border px-4 py-2.5 text-gray-200 transition-colors focus:outline-none ${
              !isConnected || sending ? 'opacity-60' : ''
            } ${
              isDmMode
                ? 'border-purple-600/50 bg-purple-900/20 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30'
                : 'bg-secondary-dark/80 focus:border-brand-green/50 focus:ring-brand-green/30 border-gray-600/50 focus:ring-1'
            }`}
            maxLength={getChatPayloadLimit(protocol) * MAX_CHUNKS}
          />
        </div>
        {/* end relative wrapper */}
        {/* Compose emoji picker toggle */}
        <button
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focused; also pre-focus it so OS settles before showEmojiPanel()
            if (!isLinux) inputRef.current?.focus();
          }}
          onClick={() => {
            if (isLinux) {
              setShowComposePicker((prev) => !prev);
            } else {
              void window.electronAPI.showEmojiPanel();
            }
          }}
          disabled={!isConnected || sending}
          aria-label={t('chatPanel.emojiButton')}
          className={`rounded-xl px-2.5 py-2.5 transition-colors disabled:opacity-50 ${
            showComposePicker
              ? 'bg-brand-green/20 text-bright-green'
              : 'bg-secondary-dark/80 text-muted border border-gray-600/50 hover:text-gray-300'
          }`}
          title={t('chatPanel.insertEmoji')}
        >
          😊
        </button>
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending || inputChunks === null}
          aria-label={
            sending
              ? t('chatPanel.sendButtonSending')
              : !isConnected || (isMqttOnly && protocol === 'meshcore')
                ? 'Queue message'
                : isDmMode
                  ? t('chatPanel.sendButtonDm')
                  : t('chatPanel.sendButton')
          }
          className={`rounded-xl px-5 py-2.5 font-medium transition-colors ${
            !isConnected || (isMqttOnly && protocol === 'meshcore')
              ? 'disabled:text-muted bg-slate-600 text-white hover:bg-slate-500 disabled:bg-gray-600'
              : isDmMode
                ? 'disabled:text-muted bg-purple-600 text-white hover:bg-purple-500 disabled:bg-gray-600'
                : 'disabled:text-muted bg-green-500 text-white hover:bg-green-400 disabled:bg-gray-600'
          }`}
        >
          {sending
            ? t('chatPanel.sendButtonSending')
            : !isConnected || (isMqttOnly && protocol === 'meshcore')
              ? 'Queue'
              : inputChunks !== null && inputChunks.length > 0
                ? `Send ${inputChunks.length} Parts`
                : isDmMode
                  ? t('chatPanel.sendButtonDm')
                  : t('chatPanel.sendButton')}
        </button>
      </div>
      {/* Character count — only show near limit */}
      {countMessageChars(input) > Math.floor(getChatPayloadLimit(protocol) * 0.8) && (
        <div className="text-muted mt-1 text-right text-xs">
          {inputChunks === null ? (
            <span className="text-red-400">
              {countMessageChars(input)}/{getChatPayloadLimit(protocol)} — too long (max{' '}
              {MAX_CHUNKS} parts)
            </span>
          ) : inputChunks.length > 0 ? (
            <span>
              {countMessageChars(input)}/{getChatPayloadLimit(protocol)} — will send as{' '}
              {inputChunks.length} parts
            </span>
          ) : (
            <span>
              {countMessageChars(input)}/{getChatPayloadLimit(protocol)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ChatPanel);
