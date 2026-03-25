import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  dismissedDmTabsStorageKey,
  lastReadStorageKey,
  loadOpenDmTabsInitial,
  loadPersistedLastReadInitial,
  openDmTabsStorageKey,
} from '../lib/chatPanelProtocolStorage';
import { parseStoredJson } from '../lib/parseStoredJson';
import { emojiDisplayChar, emojiDisplayLabel } from '../lib/reactions';
import type { ChatMessage, MeshNode, MeshProtocol } from '../lib/types';

/** Meshtastic prefers short_name; MeshCore shows full companion names (long_name). */
function nodeDisplayName(node: MeshNode | undefined, protocol: MeshProtocol): string {
  if (!node) return '';
  if (protocol === 'meshcore') {
    return node.long_name || node.short_name || '';
  }
  return node.short_name || node.long_name || '';
}
import { HelpTooltip } from './HelpTooltip';

function StatusBadge({
  status,
  transport,
  connectionType,
  error,
}: {
  status: 'sending' | 'acked' | 'failed';
  transport: 'device' | 'mqtt';
  connectionType?: 'ble' | 'serial' | 'http' | null;
  error?: string;
}) {
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

function TransportBadge({ via }: { via: 'rf' | 'mqtt' | 'both' }) {
  const rfIcon = (
    <svg
      className="w-3 h-3 text-blue-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>Received via RF</title>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
  const mqttIcon = (
    <svg
      className="w-3 h-3 text-purple-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>Received via MQTT</title>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );

  if (via === 'both') {
    return (
      <span className="flex flex-col items-center gap-px" title="Received via RF + MQTT">
        {rfIcon}
        {mqttIcon}
      </span>
    );
  }
  return via === 'rf' ? rfIcon : mqttIcon;
}

// Standard emoji reaction set — Row 1: iMessage Classic, Row 2: WhatsApp/RCS Extended
const REACTION_EMOJIS = [
  // Row 1 (6)
  { code: 128077, label: '\ud83d\udc4d', name: 'Like' }, // 👍
  { code: 10084, label: '\u2764\ufe0f', name: 'Love' }, // ❤️
  { code: 128514, label: '\ud83d\ude02', name: 'Laugh' }, // 😂
  { code: 128078, label: '\ud83d\udc4e', name: 'Dislike' }, // 👎
  { code: 127881, label: '\ud83c\udf89', name: 'Party' }, // 🎉
  { code: 128558, label: '\ud83d\ude2e', name: 'Wow' }, // 😮
  // Row 2 (6)
  { code: 128546, label: '\ud83d\ude22', name: 'Sad' }, // 😢
  { code: 128075, label: '\ud83d\udc4b', name: 'Wave' }, // 👋
  { code: 128591, label: '\ud83d\ude4f', name: 'Thanks' }, // 🙏
  { code: 128293, label: '\ud83d\udd25', name: 'Fire' }, // 🔥
  { code: 9989, label: '\u2705', name: 'Check' }, // ✅
  { code: 129300, label: '\ud83e\udd14', name: 'Thinking' }, // 🤔
];

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

/** Highlight search matches in text */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const splitRegex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(splitRegex);
  const lowerQuery = query.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={i} className="bg-yellow-500/40 text-yellow-200 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function UnreadDivider() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-red-500/50" />
      <span className="text-[10px] text-red-400 font-semibold uppercase tracking-wider shrink-0 bg-red-500/10 border border-red-500/30 rounded-full px-2.5 py-0.5">
        New messages
      </span>
      <div className="flex-1 border-t border-red-500/50" />
    </div>
  );
}

function withoutDmNode(source: Record<number, number>, nodeNum: number): Record<number, number> {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => Number(key) !== nodeNum),
  ) as Record<number, number>;
}

interface Props {
  messages: ChatMessage[];
  channels: { index: number; name: string }[];
  myNodeNum: number;
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
  onGlobalSearch?: () => void;
  /** When `meshcore`, show full names, hide redundant RF-only transport badge, block threaded replies. */
  protocol?: MeshProtocol;
}

function ChatPanel({
  messages,
  channels,
  myNodeNum,
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
  onGlobalSearch,
  protocol = 'meshtastic',
}: Props) {
  const [input, setInput] = useState('');
  const [channel, setChannel] = useState(() => (channels.length > 0 ? channels[0].index : 0));
  useEffect(() => {
    if (channels.length > 0 && !channels.some((c) => c.index === channel)) {
      setChannel(channels[0].index);
    }
  }, [channels, channel]);
  const [sending, setSending] = useState(false);
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [showComposePicker, setShowComposePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Two-section UI state — load DM tabs from localStorage for restart persistence
  const [viewMode, setViewMode] = useState<'channels' | 'dm'>('channels');
  const [openDmTabs, setOpenDmTabs] = useState<number[]>(() => loadOpenDmTabsInitial(protocol));
  const openDmTabsRef = useRef(openDmTabs);
  openDmTabsRef.current = openDmTabs;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
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
      console.warn('[ChatPanel] persist openDmTabs failed', e);
    }
  }, [openDmTabs, protocol]);

  useEffect(() => {
    try {
      localStorage.setItem(dismissedDmTabsStorageKey(protocol), JSON.stringify(dismissedDmTabs));
    } catch (e) {
      console.warn('[ChatPanel] persist dismissedDmTabs failed', e);
    }
  }, [dismissedDmTabs, protocol]);

  // Track unread counts per channel
  const lastReadRef = useRef<Map<number, number>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(new Map());

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
      console.warn('[ChatPanel] persist lastRead failed', e);
    }
  }, [persistedLastRead, protocol]);

  const getDmLabel = useCallback(
    (nodeNum: number) => {
      const node = nodes.get(nodeNum);
      const label = nodeDisplayName(node, protocol);
      return label || `!${nodeNum.toString(16)}`;
    },
    [nodes, protocol],
  );

  useEffect(() => {
    if (protocol === 'meshcore') setReplyTo(null);
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
    const reactions = new Map<number, { emoji: number; sender_name: string }[]>();

    for (const msg of messages) {
      if (msg.emoji && msg.replyId) {
        const existing = reactions.get(msg.replyId) ?? [];
        existing.push({ emoji: msg.emoji, sender_name: msg.sender_name });
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
      if (msg.to == null) continue;
      // Mirror the DM thread filter in `filteredMessages`:
      // - outgoing: sender_id == me, to == peer
      // - incoming: sender_id == peer, to == me
      let peer: number | undefined;
      if (msg.sender_id === myNodeNum && msg.to !== myNodeNum) peer = msg.to;
      if (msg.to === myNodeNum && msg.sender_id !== myNodeNum) peer = msg.sender_id;
      if (peer == null) continue;
      peers.set(peer, (peers.get(peer) ?? 0) + 1);
    }
    return peers;
  }, [regularMessages, myNodeNum]);

  const visibleDmTabs = useMemo(() => {
    const all = new Set(openDmTabs);
    for (const [nodeNum, dmCount] of inferredDmTabs) {
      const dismissedCount = dismissedDmTabs[nodeNum] ?? 0;
      if (dmCount > dismissedCount) {
        all.add(nodeNum);
      }
    }
    return Array.from(all);
  }, [openDmTabs, inferredDmTabs, dismissedDmTabs]);

  const inferredDmTabSet = useMemo(() => new Set(inferredDmTabs.keys()), [inferredDmTabs]);

  // Lookup map for rendering quoted replies (packetId in Meshtastic, timestamp fallback in MeshCore)
  const messageByReplyKey = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    for (const msg of regularMessages) {
      if (msg.packetId != null) map.set(msg.packetId, msg);
      map.set(msg.timestamp, msg);
    }
    return map;
  }, [regularMessages]);

  // Update unread counts when messages change
  useEffect(() => {
    const counts = new Map<number, number>();
    for (const msg of regularMessages) {
      if (msg.sender_id === myNodeNum) continue; // own messages don't count
      if (msg.to) continue; // DMs don't contribute to channel unread counts
      const lastRead = lastReadRef.current.get(msg.channel) ?? 0;
      if (msg.timestamp > lastRead) {
        counts.set(msg.channel, (counts.get(msg.channel) ?? 0) + 1);
      }
    }
    setUnreadCounts(counts);
  }, [regularMessages, myNodeNum]);

  // Mark current channel as read when switching or viewing
  useEffect(() => {
    if (viewMode === 'channels') {
      const now = Date.now();
      if (channel === -1) {
        // "All" view: mark every channel as read
        for (const ch of channelsRef.current) {
          lastReadRef.current.set(ch.index, now);
        }
        setUnreadCounts(new Map());
      } else {
        lastReadRef.current.set(channel, now);
        setUnreadCounts((prev) => {
          const next = new Map(prev);
          next.delete(channel);
          return next;
        });
      }
    }
  }, [channel, regularMessages.length, viewMode]);

  const filteredMessages = useMemo(() => {
    let msgs: ChatMessage[];

    if (viewMode === 'dm' && activeDmNode != null) {
      // DM mode: show conversation between self and active DM node
      msgs = regularMessages.filter(
        (m) =>
          (m.to === activeDmNode && m.sender_id === myNodeNum) ||
          (m.sender_id === activeDmNode && m.to === myNodeNum),
      );
    } else {
      // Channel mode: show only broadcast messages (no DMs)
      msgs = regularMessages.filter((m) => !m.to && (channel === -1 || m.channel === channel));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter(
        (m) => m.payload.toLowerCase().includes(q) || m.sender_name.toLowerCase().includes(q),
      );
    }
    return msgs;
  }, [regularMessages, channel, searchQuery, viewMode, activeDmNode, myNodeNum]);

  const viewKey = useMemo(() => {
    if (viewMode === 'dm' && activeDmNode != null) return `dm:${activeDmNode}`;
    return `ch:${channel}`;
  }, [viewMode, activeDmNode, channel]);

  // On view switch: snapshot lastRead for divider + arm scroll trigger
  useEffect(() => {
    if (viewKey === 'ch:-1') {
      // "All" view: no divider, just scroll to bottom
      setUnreadDividerTimestamp(0);
      setTriggerScrollToUnread((n) => n + 1);
      return;
    }
    const snapshot = persistedLastReadRef.current[viewKey] ?? 0;
    setUnreadDividerTimestamp(snapshot);
    setTriggerScrollToUnread((n) => n + 1);
  }, [viewKey]);

  // Scroll tracking for scroll-to-bottom button + mark-as-read when at bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distFromBottom > 200);

    if (distFromBottom < 50) {
      const now = Date.now();
      setPersistedLastRead((prev) => ({ ...prev, [viewKey]: now }));
      setUnreadDividerTimestamp(0); // hide divider once user has read to bottom
    }
  }, [viewKey]);

  // Auto-scroll on new messages (only if near bottom)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredMessages.length]);

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
  }, [triggerScrollToUnread, isActive]);

  const scrollToUnreadOrBottom = useCallback(() => {
    if (unreadDividerRef.current) {
      unreadDividerRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpenFor(null);
        setShowComposePicker(false);
        if (replyTo) {
          setReplyTo(null);
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
  }, [showSearch, viewMode, replyTo]);

  // Toggle search with Cmd+F / Ctrl+F
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => {
      window.removeEventListener('keydown', handleKeys);
    };
  }, []);

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  const handleSend = async () => {
    if (!input.trim() || !isConnected || sending) return;
    setSending(true);
    setChatActionError(null);
    try {
      console.debug('[ChatPanel] handleSend');
      const sendChannel = channel === -1 ? 0 : channel;
      const destination = viewMode === 'dm' && activeDmNode != null ? activeDmNode : undefined;
      const sendOutcome = onSend(input.trim(), sendChannel, destination, replyTo?.packetId);
      await Promise.resolve(sendOutcome);
      setInput('');
      setReplyTo(null);
      const now = Date.now();
      setPersistedLastRead((prev) => ({ ...prev, [viewKey]: now }));
      setUnreadDividerTimestamp(0);
    } catch (err) {
      console.error('[ChatPanel] Send failed:', err);
      setChatActionError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (emojiCode: number, packetId: number, msgChannel: number) => {
    setPickerOpenFor(null);
    setChatActionError(null);
    try {
      console.debug('[ChatPanel] handleReact', emojiCode, packetId, msgChannel);
      await onReact(emojiCode, packetId, msgChannel);
    } catch (err) {
      console.error('[ChatPanel] React failed:', err);
      setChatActionError(err instanceof Error ? err.message : 'Reaction failed');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const insertEmojiAtCursor = (code: number) => {
    const el = inputRef.current;
    const char = String.fromCodePoint(code);
    // emoji is a surrogate pair = 2 UTF-16 code units
    const charLen = char.length;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const newVal = input.slice(0, start) + char + input.slice(end);
    if (newVal.length > 228) return; // enforce maxLength
    setInput(newVal);
    setShowComposePicker(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + charLen, start + charLen);
    });
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
      if (protocol === 'meshtastic' && inferredDmTabSet.has(nodeNum)) {
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
    [activeDmNode, inferredDmTabSet, inferredDmTabs, protocol, visibleDmTabs],
  );

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** Group reactions by emoji code for a message key (packetId or timestamp fallback) */
  function getGroupedReactions(messageKey: number | undefined) {
    if (!messageKey) return [];
    const reactions = reactionsByReplyId.get(messageKey);
    if (!reactions) return [];

    const grouped = new Map<number, string[]>();
    for (const r of reactions) {
      const existing = grouped.get(r.emoji) ?? [];
      existing.push(r.sender_name);
      grouped.set(r.emoji, existing);
    }
    return Array.from(grouped.entries()).map(([emoji, senders]) => ({
      emoji,
      count: senders.length,
      tooltip: `${emojiDisplayLabel(emoji)}: ${senders.join(', ')}`,
    }));
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
  // Returns -1 when: All view, search active, timestamp=0, or no qualifying messages.
  const unreadStartIndex = useMemo(() => {
    if (channel === -1 || searchQuery.trim() || unreadDividerTimestamp === 0) return -1;
    for (let i = 0; i < filteredMessages.length; i++) {
      const msg = filteredMessages[i];
      if (msg.sender_id !== myNodeNum && msg.timestamp > unreadDividerTimestamp) return i;
    }
    return -1;
  }, [filteredMessages, myNodeNum, unreadDividerTimestamp, channel, searchQuery]);

  const isDmMode = viewMode === 'dm' && activeDmNode != null;
  const dmNodeName = activeDmNode != null ? getDmLabel(activeDmNode) : '';
  const composePlaceholder = useMemo(
    () =>
      isDmMode
        ? `DM to ${dmNodeName}...`
        : !isConnected
          ? 'Connect to send messages'
          : isMqttOnly
            ? 'Type a message (via MQTT)...'
            : 'Type a message...',
    [isDmMode, dmNodeName, isConnected, isMqttOnly],
  );

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-10rem)]">
      {/* Row 1 — Channel selector + Search toggle */}
      <div className={`flex items-center gap-2 mb-1 ${viewMode === 'dm' ? 'opacity-50' : ''}`}>
        <span className="text-[10px] text-muted font-medium uppercase tracking-wider mr-1">
          Channels
        </span>
        <button
          aria-label="All"
          onClick={() => {
            setChannel(-1);
            setViewMode('channels');
          }}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            viewMode === 'channels' && channel === -1
              ? 'bg-readable-green text-white'
              : 'bg-secondary-dark text-muted hover:text-gray-200'
          }`}
        >
          All
        </button>
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
              className={`relative px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                viewMode === 'channels' && channel === ch.index
                  ? 'bg-readable-green text-white'
                  : 'bg-secondary-dark text-muted hover:text-gray-200'
              }`}
            >
              {ch.name}
              {unread > 0 && !(viewMode === 'channels' && channel === ch.index) && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search toggle */}
        <button
          onClick={() => {
            setShowSearch(!showSearch);
          }}
          aria-pressed={showSearch}
          aria-label="Search messages"
          className={`p-1.5 rounded-lg transition-colors ${
            showSearch ? 'bg-brand-green/20 text-bright-green' : 'text-muted hover:text-gray-300'
          }`}
          title="Search messages (Cmd+F)"
        >
          <svg
            className="w-4 h-4"
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
        {onGlobalSearch && (
          <button
            onClick={onGlobalSearch}
            aria-label="Search all channels"
            className="p-1.5 rounded-lg transition-colors text-muted hover:text-gray-300"
            title="Search all channels (Cmd+Shift+F)"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Row 2 — DM tabs */}
      <div
        className={`flex items-center gap-2 mb-2 min-h-[28px] ${viewMode === 'channels' ? 'opacity-50' : ''}`}
      >
        <span className="text-[10px] text-muted font-medium uppercase tracking-wider mr-1">
          DMs
        </span>
        {visibleDmTabs.length === 0 ? (
          <span className="text-[10px] text-gray-600 italic">No conversations</span>
        ) : (
          visibleDmTabs.map((nodeNum) => (
            <div
              key={nodeNum}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
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
              {protocol === 'meshtastic' && (
                <button
                  type="button"
                  onClick={() => {
                    closeDmTab(nodeNum);
                  }}
                  aria-label="x"
                  className="ml-0.5 text-muted hover:text-white text-[10px] leading-none"
                  title="Close DM"
                >
                  x
                </button>
              )}
            </div>
          ))
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
            placeholder="Search messages..."
            aria-label="Search messages..."
            spellCheck={false}
            className="w-full px-3 py-1.5 bg-secondary-dark/80 rounded-lg text-gray-200 text-sm border border-gray-600/50 focus:border-brand-green/50 focus:outline-none"
          />
          {searchQuery && (
            <div className="text-xs text-muted mt-1">
              {filteredMessages.length} result{filteredMessages.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Disconnected overlay */}
      {!isConnected && (
        <div className="bg-deep-black/60 border border-gray-700 rounded-xl p-4 mb-2 text-center">
          <p className="text-muted text-sm">Not connected — messages are read-only</p>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-deep-black/50 rounded-xl p-3 space-y-1.5 min-h-0 relative"
      >
        {filteredMessages.length === 0 ? (
          <div className="text-center text-muted py-12">
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
            const isOwn = msg.sender_id === myNodeNum;
            const isDm = !!msg.to;
            const reactions = getGroupedReactions(msg.packetId ?? msg.timestamp);
            const showPicker = pickerOpenFor === (msg.packetId ?? msg.timestamp);
            const pickerOpensAbove = i >= filteredMessages.length - 3;

            const senderNode = nodes.get(msg.sender_id);
            const displaySenderName = nodeDisplayName(senderNode, protocol) || msg.sender_name;

            // Day separator
            const daySeparator = daySeparatorIndices.has(i) ? (
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 border-t border-gray-700" />
                <span className="text-xs text-muted font-medium shrink-0">
                  {formatDayLabel(msg.timestamp)}
                </span>
                <div className="flex-1 border-t border-gray-700" />
              </div>
            ) : null;

            const isUnreadStart = i === unreadStartIndex;

            return (
              <div
                key={
                  msg.id != null ? `db-${msg.id}` : `${msg.timestamp}-${msg.packetId ?? 'x'}-${i}`
                }
              >
                {daySeparator}
                {isUnreadStart && (
                  <div ref={unreadDividerRef}>
                    <UnreadDivider />
                  </div>
                )}
                <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                  {/* Bubble row */}
                  <div
                    className={`group/msg flex items-end gap-1 max-w-[80%] ${
                      isOwn ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Message bubble */}
                    <div
                      className={`rounded-2xl px-3 py-2 min-w-0 ${
                        isDm
                          ? isOwn
                            ? 'rounded-br-sm bg-purple-600/20 border border-purple-500/30'
                            : 'rounded-bl-sm bg-purple-700/20 border border-purple-600/30'
                          : isOwn
                            ? 'rounded-br-sm bg-blue-600/20 border border-blue-500/30'
                            : 'rounded-bl-sm bg-secondary-dark/50 border border-gray-600/30'
                      }`}
                    >
                      {/* Header: sender name (clickable) + DM indicator + time */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          onClick={() => {
                            onNodeClick(msg.sender_id);
                          }}
                          className={`text-xs font-semibold cursor-pointer hover:underline ${
                            isDm ? 'text-purple-400' : isOwn ? 'text-blue-400' : 'text-bright-green'
                          }`}
                        >
                          {displaySenderName}
                        </button>
                        {isDm && (
                          <span className="text-[10px] text-purple-400/70 font-medium">DM</span>
                        )}
                        <span className="text-[10px] text-muted/70">
                          {formatTime(msg.timestamp)}
                        </span>
                        {channels.length > 1 && !isDm && (
                          <span className="text-[10px] text-gray-600">ch{msg.channel}</span>
                        )}
                      </div>

                      {/* Quoted reply preview */}
                      {msg.replyId &&
                        !msg.emoji &&
                        messageByReplyKey.has(msg.replyId) &&
                        (() => {
                          const orig = messageByReplyKey.get(msg.replyId)!;
                          return (
                            <div className="flex gap-1.5 mb-1.5 opacity-80">
                              <div className="w-0.5 rounded-full bg-gray-500 shrink-0" />
                              <div className="min-w-0">
                                <span className="text-[10px] font-semibold text-gray-400 block">
                                  {nodeDisplayName(nodes.get(orig.sender_id), protocol) ||
                                    orig.sender_name}
                                </span>
                                <span className="text-[11px] text-gray-500 block truncate">
                                  {orig.payload.length > 80
                                    ? orig.payload.slice(0, 80) + '…'
                                    : orig.payload}
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Message text with optional search highlight */}
                      <p className="text-sm text-gray-200 break-words whitespace-pre-wrap leading-relaxed">
                        <HighlightText text={msg.payload} query={searchQuery} />
                      </p>

                      {/* Transport indicator for incoming messages (MeshCore is RF-first; hide redundant RF-only badge) */}
                      {!isOwn &&
                        msg.receivedVia &&
                        (protocol !== 'meshcore' ||
                          msg.receivedVia === 'mqtt' ||
                          msg.receivedVia === 'both') && (
                          <div className="flex items-center justify-end mt-0.5">
                            <TransportBadge via={msg.receivedVia} />
                          </div>
                        )}

                      {/* Delivery status for own messages */}
                      {isOwn && (msg.status || msg.mqttStatus) && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {isOwn && msg.status === 'failed' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onResend(msg);
                              }}
                              className="text-gray-500 hover:text-gray-300 transition-colors"
                              title="Resend message"
                            >
                              <svg
                                className="w-3.5 h-3.5"
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
                    {isConnected && (
                      <div className="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 flex gap-0.5 transition-all shrink-0">
                        {/* Reply (Meshtastic threaded replies; not supported on MeshCore transport) */}
                        {protocol !== 'meshcore' && (
                          <button
                            onClick={() => {
                              setReplyTo(msg);
                              inputRef.current?.focus();
                            }}
                            className="text-gray-600 hover:text-blue-400 text-xs p-1 rounded"
                            aria-label="Reply to message"
                            title="Reply"
                          >
                            <svg
                              className="w-3.5 h-3.5"
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
                        )}
                        {/* React */}
                        <button
                          onClick={() => {
                            setPickerOpenFor(showPicker ? null : (msg.packetId ?? msg.timestamp));
                          }}
                          className="text-gray-600 hover:text-gray-300 text-xs p-1 rounded"
                          aria-label="Add reaction"
                          title="React"
                        >
                          <svg
                            className="w-3.5 h-3.5"
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
                            className="text-gray-600 hover:text-purple-400 text-xs p-1 rounded"
                            title={`Direct message ${msg.sender_name}`}
                          >
                            <svg
                              className="w-3.5 h-3.5"
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
                      </div>
                    )}
                  </div>

                  {/* Emoji picker */}
                  {showPicker && (
                    <div
                      className={`flex flex-col gap-0.5 bg-secondary-dark border border-gray-600 rounded-xl px-2 py-1.5 shadow-lg ${
                        pickerOpensAbove ? 'mb-1 order-first' : 'mt-1'
                      } ${isOwn ? 'self-end' : 'self-start'}`}
                    >
                      <div className="flex gap-1">
                        {REACTION_EMOJIS.slice(0, 6).map((re) => (
                          <button
                            key={re.code}
                            onClick={() =>
                              handleReact(re.code, msg.packetId ?? msg.timestamp, msg.channel)
                            }
                            className="hover:scale-125 transition-transform text-lg px-0.5"
                            title={re.name}
                          >
                            {re.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1 justify-center">
                        {REACTION_EMOJIS.slice(6).map((re) => (
                          <button
                            key={re.code}
                            onClick={() =>
                              handleReact(re.code, msg.packetId ?? msg.timestamp, msg.channel)
                            }
                            className="hover:scale-125 transition-transform text-lg px-0.5"
                            title={re.name}
                          >
                            {re.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reaction badges */}
                  {reactions.length > 0 && (
                    <div className={`flex gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                      {reactions.map((r) => (
                        <span
                          key={r.emoji}
                          className="inline-flex items-center gap-0.5 bg-secondary-dark/80 border border-gray-600/50 rounded-full px-1.5 py-0.5 text-xs cursor-default"
                          title={r.tooltip}
                        >
                          {emojiDisplayChar(r.emoji)}
                          {r.count > 1 && <span className="text-muted text-[10px]">{r.count}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />

        {/* Scroll to unread / bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToUnreadOrBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-secondary-dark hover:bg-gray-600 text-gray-300 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg border border-gray-600 transition-all flex items-center gap-1.5 z-10"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            Jump to Unread
          </button>
        )}
      </div>

      {/* Compose emoji picker — renders above the input row */}
      {showComposePicker && (
        <div className="flex flex-col gap-0.5 bg-secondary-dark border border-gray-600 rounded-xl px-2 py-1.5 mb-1 shadow-lg self-start">
          <div className="flex gap-1">
            {REACTION_EMOJIS.slice(0, 6).map((re) => (
              <button
                key={re.code}
                onClick={() => {
                  insertEmojiAtCursor(re.code);
                }}
                className="hover:scale-125 transition-transform text-lg px-0.5"
                title={re.name}
              >
                {re.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 justify-center">
            {REACTION_EMOJIS.slice(6).map((re) => (
              <button
                key={re.code}
                onClick={() => {
                  insertEmojiAtCursor(re.code);
                }}
                className="hover:scale-125 transition-transform text-lg px-0.5"
                title={re.name}
              >
                {re.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Reply preview bar */}
      {replyTo && protocol !== 'meshcore' && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-secondary-dark/80 border border-gray-600/50 rounded-xl text-xs">
          <svg
            className="w-3 h-3 text-blue-400 shrink-0"
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
            <span className="text-gray-200 font-medium">
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
            className="text-muted hover:text-gray-200 ml-1 leading-none"
            title="Cancel reply"
          >
            ×
          </button>
        </div>
      )}

      {chatActionError && (
        <div role="alert" className="text-sm text-red-400 mt-2 px-1">
          {chatActionError}
        </div>
      )}

      {/* Input area — textarea so Chromium applies spellcheck (single-line inputs often skip it) */}
      <div className="flex gap-2 mt-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setChatActionError(null);
          }}
          onKeyDown={handleKeyDown}
          spellCheck
          lang={
            typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined
          }
          enterKeyHint="send"
          placeholder={composePlaceholder}
          aria-label={composePlaceholder}
          className={`flex-1 min-h-[42px] max-h-32 px-4 py-2.5 rounded-xl text-gray-200 border focus:outline-none transition-colors resize-none overflow-y-auto ${
            !isConnected || sending ? 'opacity-60' : ''
          } ${
            isDmMode
              ? 'bg-purple-900/20 border-purple-600/50 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30'
              : 'bg-secondary-dark/80 border-gray-600/50 focus:border-brand-green/50 focus:ring-1 focus:ring-brand-green/30'
          }`}
          maxLength={228}
        />
        {/* Compose emoji picker toggle */}
        <button
          onClick={() => {
            setShowComposePicker((prev) => !prev);
          }}
          disabled={!isConnected || sending}
          aria-label="😊"
          className={`px-2.5 py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
            showComposePicker
              ? 'bg-brand-green/20 text-bright-green'
              : 'bg-secondary-dark/80 text-muted hover:text-gray-300 border border-gray-600/50'
          }`}
          title="Insert emoji"
        >
          😊
        </button>
        <button
          onClick={handleSend}
          disabled={!isConnected || !input.trim() || sending}
          aria-label={sending ? '...' : isDmMode ? 'DM' : 'Send'}
          className={`px-5 py-2.5 font-medium rounded-xl transition-colors ${
            isDmMode
              ? 'bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:text-muted text-white'
              : 'bg-[#4CAF50] hover:bg-[#43A047] disabled:bg-gray-600 disabled:text-muted text-white'
          }`}
        >
          {sending ? '...' : isDmMode ? 'DM' : 'Send'}
        </button>
      </div>
      {/* Character count — only show near limit */}
      {input.length > 180 && (
        <div className="text-xs text-muted mt-1 text-right">{input.length}/228</div>
      )}
    </div>
  );
}

export default memo(ChatPanel);
