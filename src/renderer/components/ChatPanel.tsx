import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import type { ChatMessage, MeshNode } from "../lib/types";

// Standard emoji reaction set — Row 1: iMessage Classic, Row 2: WhatsApp/RCS Extended
const REACTION_EMOJIS = [
  // Row 1 (6)
  { code: 128077, label: "\ud83d\udc4d", name: "Like"      },  // 👍
  { code: 10084,  label: "\u2764\ufe0f", name: "Love"      },  // ❤️
  { code: 128514, label: "\ud83d\ude02", name: "Laugh"     },  // 😂
  { code: 128078, label: "\ud83d\udc4e", name: "Dislike"   },  // 👎
  { code: 127881, label: "\ud83c\udf89", name: "Party"     },  // 🎉
  { code: 128558, label: "\ud83d\ude2e", name: "Wow"       },  // 😮
  // Row 2 (6)
  { code: 128546, label: "\ud83d\ude22", name: "Sad"       },  // 😢
  { code: 128075, label: "\ud83d\udc4b", name: "Wave"      },  // 👋
  { code: 128591, label: "\ud83d\ude4f", name: "Thanks"    },  // 🙏
  { code: 128293, label: "\ud83d\udd25", name: "Fire"      },  // 🔥
  { code: 9989,   label: "\u2705",       name: "Check"     },  // ✅
  { code: 129300, label: "\ud83e\udd14", name: "Thinking"  },  // 🤔
];

const REACTION_LABEL_MAP = new Map(REACTION_EMOJIS.map((e) => [e.code, e.name]));

/** Convert a Unicode codepoint to an emoji string */
function emojiFromCode(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "\u2753";
  }
}

/** Format a date for day separators */
function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - msgDay.getTime();
  if (diff === 0) return "Today";
  if (diff === 86_400_000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Get a day key for grouping messages */
function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Highlight search matches in text */
function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const splitRegex = new RegExp(`(${escaped})`, "gi");
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
        )
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

interface Props {
  messages: ChatMessage[];
  channels: Array<{ index: number; name: string }>;
  myNodeNum: number;
  onSend: (text: string, channel: number, destination?: number, replyId?: number) => Promise<void>;
  onReact: (emoji: number, replyId: number, channel: number) => Promise<void>;
  onNodeClick: (nodeNum: number) => void;
  isConnected: boolean;
  isMqttOnly?: boolean;
  nodes: Map<number, MeshNode>;
  initialDmTarget?: number | null;
  onDmTargetConsumed?: () => void;
}

export default function ChatPanel({
  messages,
  channels,
  myNodeNum,
  onSend,
  onReact,
  onNodeClick,
  isConnected,
  isMqttOnly,
  nodes,
  initialDmTarget,
  onDmTargetConsumed,
}: Props) {
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState(0);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null);
  const [showComposePicker, setShowComposePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Two-section UI state — load DM tabs from localStorage for restart persistence
  const [viewMode, setViewMode] = useState<"channels" | "dm">("channels");
  const [openDmTabs, setOpenDmTabs] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem("mesh-client:openDmTabs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every((n: unknown) => typeof n === "number")) {
          return parsed;
        }
      }
    } catch { /* ignore corrupt data */ }
    return [];
  });
  const [activeDmNode, setActiveDmNode] = useState<number | null>(null);

  // Persist openDmTabs to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("mesh-client:openDmTabs", JSON.stringify(openDmTabs));
  }, [openDmTabs]);

  // Track unread counts per channel
  const lastReadRef = useRef<Map<number, number>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(new Map());

  // Persisted lastRead: { "ch:0": timestamp, "ch:2": ..., "dm:12345678": ... }
  const [persistedLastRead, setPersistedLastRead] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem("mesh-client:lastRead");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore corrupt */ }
    return {};
  });
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
    localStorage.setItem("mesh-client:lastRead", JSON.stringify(persistedLastRead));
  }, [persistedLastRead]);

  const getDmLabel = useCallback((nodeNum: number) => {
    const node = nodes.get(nodeNum);
    return node?.short_name || node?.long_name || `!${nodeNum.toString(16)}`;
  }, [nodes]);

  // Handle initialDmTarget from Nodes tab
  useEffect(() => {
    if (initialDmTarget != null) {
      if (!openDmTabs.includes(initialDmTarget)) {
        setOpenDmTabs(prev => [...prev, initialDmTarget]);
      }
      setActiveDmNode(initialDmTarget);
      setViewMode("dm");
      onDmTargetConsumed?.();
    }
  }, [initialDmTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Separate regular messages from reaction messages
  const { regularMessages, reactionsByReplyId } = useMemo(() => {
    const regular: ChatMessage[] = [];
    const reactions = new Map<
      number,
      Array<{ emoji: number; sender_name: string }>
    >();

    for (const msg of messages) {
      if (msg.emoji && msg.replyId) {
        const existing = reactions.get(msg.replyId) || [];
        existing.push({ emoji: msg.emoji, sender_name: msg.sender_name });
        reactions.set(msg.replyId, existing);
      } else {
        regular.push(msg);
      }
    }
    return { regularMessages: regular, reactionsByReplyId: reactions };
  }, [messages]);

  // Lookup map for rendering quoted replies
  const messageByPacketId = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    for (const msg of regularMessages) {
      if (msg.packetId) map.set(msg.packetId, msg);
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
    if (viewMode === "channels") {
      const now = Date.now();
      if (channel === -1) {
        // "All" view: mark every channel as read
        for (const ch of channels) {
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

    if (viewMode === "dm" && activeDmNode != null) {
      // DM mode: show conversation between self and active DM node
      msgs = regularMessages.filter(
        (m) =>
          (m.to === activeDmNode && m.sender_id === myNodeNum) ||
          (m.sender_id === activeDmNode && m.to === myNodeNum)
      );
    } else {
      // Channel mode: show only broadcast messages (no DMs)
      msgs = regularMessages.filter(
        (m) => !m.to && (channel === -1 || m.channel === channel)
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      msgs = msgs.filter(
        (m) =>
          m.payload.toLowerCase().includes(q) ||
          m.sender_name.toLowerCase().includes(q)
      );
    }
    return msgs;
  }, [regularMessages, channel, searchQuery, viewMode, activeDmNode, myNodeNum]);

  const viewKey = useMemo(() => {
    if (viewMode === "dm" && activeDmNode != null) return `dm:${activeDmNode}`;
    return `ch:${channel}`;
  }, [viewMode, activeDmNode, channel]);

  // On view switch: snapshot lastRead for divider + arm scroll trigger
  useEffect(() => {
    if (channel === -1) {
      // "All" view: no divider, just scroll to bottom
      setUnreadDividerTimestamp(0);
      setTriggerScrollToUnread((n) => n + 1);
      return;
    }
    const snapshot = persistedLastReadRef.current[viewKey] ?? 0;
    setUnreadDividerTimestamp(snapshot);
    setTriggerScrollToUnread((n) => n + 1);
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally reads persistedLastRead via ref (not dep) to avoid re-firing on scroll updates

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
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredMessages.length]);

  // Fires after view switch (triggerScrollToUnread increments). useLayoutEffect
  // ensures DOM is committed before scrolling, preventing flash of wrong position.
  useLayoutEffect(() => {
    if (triggerScrollToUnread === 0) return; // skip initial mount
    if (unreadDividerRef.current) {
      unreadDividerRef.current.scrollIntoView({ block: "center" });
    } else {
      messagesEndRef.current?.scrollIntoView();
    }
  }, [triggerScrollToUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPickerOpenFor(null);
        setShowComposePicker(false);
        if (replyTo) {
          setReplyTo(null);
        } else if (showSearch) {
          setShowSearch(false);
        } else if (viewMode === "dm") {
          setViewMode("channels");
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showSearch, viewMode, replyTo]);

  // Toggle search with Cmd+F / Ctrl+F
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !isConnected || sending) return;
    setSending(true);
    try {
      const sendChannel = channel === -1 ? 0 : channel;
      const destination = viewMode === "dm" && activeDmNode != null ? activeDmNode : undefined;
      await onSend(input.trim(), sendChannel, destination, replyTo?.packetId);
      setInput("");
      setReplyTo(null);
      const now = Date.now();
      setPersistedLastRead((prev) => ({ ...prev, [viewKey]: now }));
      setUnreadDividerTimestamp(0);
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (
    emojiCode: number,
    packetId: number,
    msgChannel: number
  ) => {
    setPickerOpenFor(null);
    try {
      await onReact(emojiCode, packetId, msgChannel);
    } catch (err) {
      console.error("React failed:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
    setOpenDmTabs(prev => prev.includes(nodeNum) ? prev : [...prev, nodeNum]);
    setActiveDmNode(nodeNum);
    setViewMode("dm");
  }, []);

  // Close a DM tab
  const closeDmTab = useCallback((nodeNum: number) => {
    setOpenDmTabs(prev => prev.filter(n => n !== nodeNum));
    if (activeDmNode === nodeNum) {
      // Switch to next tab or back to channels
      const remaining = openDmTabs.filter(n => n !== nodeNum);
      if (remaining.length > 0) {
        setActiveDmNode(remaining[remaining.length - 1]);
      } else {
        setActiveDmNode(null);
        setViewMode("channels");
      }
    }
  }, [activeDmNode, openDmTabs]);

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** Group reactions by emoji code for a given packetId */
  function getGroupedReactions(packetId: number | undefined) {
    if (!packetId) return [];
    const reactions = reactionsByReplyId.get(packetId);
    if (!reactions) return [];

    const grouped = new Map<number, string[]>();
    for (const r of reactions) {
      const existing = grouped.get(r.emoji) || [];
      existing.push(r.sender_name);
      grouped.set(r.emoji, existing);
    }
    return Array.from(grouped.entries()).map(([emoji, senders]) => ({
      emoji,
      count: senders.length,
      tooltip: `${REACTION_LABEL_MAP.get(emoji) ?? emojiFromCode(emoji)}: ${senders.join(", ")}`,
    }));
  }

  // Pre-compute day separator indices (avoids mutable variable during render)
  const daySeparatorIndices = useMemo(() => {
    const indices = new Set<number>();
    let prevDayKey = "";
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

  const isDmMode = viewMode === "dm" && activeDmNode != null;
  const dmNodeName = activeDmNode != null ? getDmLabel(activeDmNode) : "";

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-10rem)]">
      {/* Row 1 — Channel selector + Search toggle */}
      <div
        className={`flex items-center gap-2 mb-1 ${viewMode === "dm" ? "opacity-50" : ""}`}
      >
        <span className="text-[10px] text-muted font-medium uppercase tracking-wider mr-1">
          Channels
        </span>
        <button
          onClick={() => { setChannel(-1); setViewMode("channels"); }}
          className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            viewMode === "channels" && channel === -1
              ? "bg-brand-green text-white"
              : "bg-secondary-dark text-muted hover:text-gray-200"
          }`}
        >
          All
        </button>
        {channels.map((ch) => {
          const unread = unreadCounts.get(ch.index) ?? 0;
          return (
            <button
              key={ch.index}
              onClick={() => { setChannel(ch.index); setViewMode("channels"); }}
              className={`relative px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                viewMode === "channels" && channel === ch.index
                  ? "bg-green-600 text-white"
                  : "bg-secondary-dark text-muted hover:text-gray-200"
              }`}
            >
              {ch.name}
              {unread > 0 && !(viewMode === "channels" && channel === ch.index) && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {/* Search toggle */}
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`p-1.5 rounded-lg transition-colors ${
            showSearch
              ? "bg-brand-green/20 text-bright-green"
              : "text-muted hover:text-gray-300"
          }`}
          title="Search messages (Cmd+F)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </div>

      {/* Row 2 — DM tabs */}
      <div
        className={`flex items-center gap-2 mb-2 min-h-[28px] ${viewMode === "channels" ? "opacity-50" : ""}`}
      >
        <span className="text-[10px] text-muted font-medium uppercase tracking-wider mr-1">
          DMs
        </span>
        {openDmTabs.length === 0 ? (
          <span className="text-[10px] text-gray-600 italic">
            No conversations
          </span>
        ) : (
          openDmTabs.map((nodeNum) => (
            <div
              key={nodeNum}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer ${
                viewMode === "dm" && activeDmNode === nodeNum
                  ? "bg-purple-600 text-white"
                  : "bg-secondary-dark text-muted hover:text-gray-200"
              }`}
              onClick={() => { setActiveDmNode(nodeNum); setViewMode("dm"); }}
            >
              <span>{getDmLabel(nodeNum)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeDmTab(nodeNum); }}
                className="ml-0.5 text-muted hover:text-white text-[10px] leading-none"
                title="Close DM"
              >
                x
              </button>
            </div>
          ))
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="mb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="w-full px-3 py-1.5 bg-secondary-dark/80 rounded-lg text-gray-200 text-sm border border-gray-600/50 focus:border-brand-green/50 focus:outline-none"
            autoFocus
          />
          {searchQuery && (
            <div className="text-xs text-muted mt-1">
              {filteredMessages.length} result{filteredMessages.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Disconnected overlay */}
      {!isConnected && (
        <div className="bg-deep-black/60 border border-gray-700 rounded-xl p-4 mb-2 text-center">
          <p className="text-muted text-sm">
            Not connected — messages are read-only
          </p>
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
              ? "No messages match your search."
              : isDmMode
              ? `No messages with ${dmNodeName} yet.`
              : isConnected
              ? "No messages yet. Send one or wait for incoming messages."
              : "Connect to a device to start chatting."}
          </div>
        ) : (
          filteredMessages.map((msg, i) => {
            const isOwn = msg.sender_id === myNodeNum;
            const isDm = !!msg.to;
            const reactions = getGroupedReactions(msg.packetId);
            const showPicker =
              pickerOpenFor === (msg.packetId ?? -(i + 1));

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
              <div key={`${msg.timestamp}-${i}`}>
                {daySeparator}
                {isUnreadStart && (
                  <div ref={unreadDividerRef}>
                    <UnreadDivider />
                  </div>
                )}
                <div
                  className={`flex flex-col ${
                    isOwn ? "items-end" : "items-start"
                  }`}
                >
                  {/* Bubble row */}
                  <div
                    className={`group/msg flex items-end gap-1 max-w-[80%] ${
                      isOwn ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Message bubble */}
                    <div
                      className={`rounded-2xl px-3 py-2 min-w-0 ${
                        isDm
                          ? isOwn
                            ? "rounded-br-sm bg-purple-600/20 border border-purple-500/30"
                            : "rounded-bl-sm bg-purple-700/20 border border-purple-600/30"
                          : isOwn
                          ? "rounded-br-sm bg-blue-600/20 border border-blue-500/30"
                          : "rounded-bl-sm bg-secondary-dark/50 border border-gray-600/30"
                      }`}
                    >
                      {/* Header: sender name (clickable) + DM indicator + time */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          onClick={() => onNodeClick(msg.sender_id)}
                          className={`text-xs font-semibold cursor-pointer hover:underline ${
                            isDm
                              ? "text-purple-400"
                              : isOwn
                              ? "text-blue-400"
                              : "text-bright-green"
                          }`}
                        >
                          {msg.sender_name}
                        </button>
                        {isDm && (
                          <span className="text-[10px] text-purple-400/70 font-medium">
                            DM
                          </span>
                        )}
                        <span className="text-[10px] text-muted/70">
                          {formatTime(msg.timestamp)}
                        </span>
                        {channels.length > 1 && !isDm && (
                          <span className="text-[10px] text-gray-600">
                            ch{msg.channel}
                          </span>
                        )}
                      </div>

                      {/* Quoted reply preview */}
                      {msg.replyId && !msg.emoji && messageByPacketId.has(msg.replyId) && (() => {
                        const orig = messageByPacketId.get(msg.replyId)!;
                        return (
                          <div className="flex gap-1.5 mb-1.5 opacity-80">
                            <div className="w-0.5 rounded-full bg-gray-500 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[10px] font-semibold text-gray-400 block">{orig.sender_name}</span>
                              <span className="text-[11px] text-gray-500 block truncate">
                                {orig.payload.length > 80 ? orig.payload.slice(0, 80) + "…" : orig.payload}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Message text with optional search highlight */}
                      <p className="text-sm text-gray-200 break-words leading-relaxed">
                        <HighlightText text={msg.payload} query={searchQuery} />
                      </p>

                      {/* Delivery status for own messages */}
                      {isOwn && msg.status && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          {msg.status === "sending" && (
                            <span
                              className="text-[10px] text-muted"
                              title="Sending..."
                            >
                              {"⏳"}
                            </span>
                          )}
                          {msg.status === "acked" && (
                            <span
                              className="text-[10px] text-bright-green"
                              title="Delivered"
                            >
                              {"✓"}
                            </span>
                          )}
                          {msg.status === "failed" && (
                            <span
                              className="text-[10px] text-red-400 cursor-help"
                              title={msg.error || "Failed to deliver"}
                            >
                              {"✗"} {msg.error || "Failed"}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Inline reaction trigger — visible on hover */}
                    {isConnected && msg.packetId && (
                      <div className="opacity-0 group-hover/msg:opacity-100 flex gap-0.5 transition-all shrink-0">
                        {/* Reply */}
                        <button
                          onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                          className="text-gray-600 hover:text-blue-400 text-xs p-1 rounded"
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
                        {/* React */}
                        <button
                          onClick={() =>
                            setPickerOpenFor(
                              showPicker
                                ? null
                                : (msg.packetId ?? -(i + 1))
                            )
                          }
                          className="text-gray-600 hover:text-gray-300 text-xs p-1 rounded"
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
                            onClick={() => openDmTo(msg.sender_id)}
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
                      className={`flex flex-col gap-0.5 bg-secondary-dark border border-gray-600 rounded-xl px-2 py-1.5 mt-1 shadow-lg ${
                        isOwn ? "self-end" : "self-start"
                      }`}
                    >
                      <div className="flex gap-1">
                        {REACTION_EMOJIS.slice(0, 6).map((re) => (
                          <button
                            key={re.code}
                            onClick={() => handleReact(re.code, msg.packetId!, msg.channel)}
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
                            onClick={() => handleReact(re.code, msg.packetId!, msg.channel)}
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
                    <div
                      className={`flex gap-1 mt-0.5 ${
                        isOwn ? "justify-end" : "justify-start"
                      }`}
                    >
                      {reactions.map((r) => (
                        <span
                          key={r.emoji}
                          className="inline-flex items-center gap-0.5 bg-secondary-dark/80 border border-gray-600/50 rounded-full px-1.5 py-0.5 text-xs cursor-default"
                          title={r.tooltip}
                        >
                          {emojiFromCode(r.emoji)}
                          {r.count > 1 && (
                            <span className="text-muted text-[10px]">
                              {r.count}
                            </span>
                          )}
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

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-secondary-dark hover:bg-gray-600 text-gray-300 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg border border-gray-600 transition-all flex items-center gap-1.5 z-10"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            New messages
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
                onClick={() => insertEmojiAtCursor(re.code)}
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
                onClick={() => insertEmojiAtCursor(re.code)}
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
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-secondary-dark/80 border border-gray-600/50 rounded-xl text-xs">
          <svg className="w-3 h-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          <span className="text-gray-400">
            Replying to{" "}
            <span className="text-gray-200 font-medium">{replyTo.sender_name}</span>:
          </span>
          <span className="flex-1 truncate text-gray-500">
            {replyTo.payload.length > 60 ? replyTo.payload.slice(0, 60) + "…" : replyTo.payload}
          </span>
          <button
            onClick={() => setReplyTo(null)}
            className="text-muted hover:text-gray-200 ml-1 leading-none"
            title="Cancel reply"
          >
            ×
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-2 mt-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected || sending}
          placeholder={
            isDmMode
              ? `DM to ${dmNodeName}...`
              : !isConnected
              ? "Connect to send messages"
              : isMqttOnly
              ? "Type a message (via MQTT)..."
              : "Type a message..."
          }
          className={`flex-1 px-4 py-2.5 rounded-xl text-gray-200 border focus:outline-none disabled:opacity-50 transition-colors ${
            isDmMode
              ? "bg-purple-900/20 border-purple-600/50 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
              : "bg-secondary-dark/80 border-gray-600/50 focus:border-brand-green/50 focus:ring-1 focus:ring-brand-green/30"
          }`}
          maxLength={228}
        />
        {/* Compose emoji picker toggle */}
        <button
          onClick={() => setShowComposePicker((prev) => !prev)}
          disabled={!isConnected || sending}
          className={`px-2.5 py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
            showComposePicker
              ? "bg-brand-green/20 text-bright-green"
              : "bg-secondary-dark/80 text-muted hover:text-gray-300 border border-gray-600/50"
          }`}
          title="Insert emoji"
        >
          😊
        </button>
        <button
          onClick={handleSend}
          disabled={!isConnected || !input.trim() || sending}
          className={`px-5 py-2.5 font-medium rounded-xl transition-colors ${
            isDmMode
              ? "bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:text-muted text-white"
              : "bg-[#4CAF50] hover:bg-[#43A047] disabled:bg-gray-600 disabled:text-muted text-white"
          }`}
        >
          {sending ? "..." : isDmMode ? "DM" : "Send"}
        </button>
      </div>
      {/* Character count — only show near limit */}
      {input.length > 180 && (
        <div className="text-xs text-muted mt-1 text-right">
          {input.length}/228
        </div>
      )}
    </div>
  );
}
