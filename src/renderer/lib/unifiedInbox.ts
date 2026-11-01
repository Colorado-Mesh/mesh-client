import type { MeshProtocol } from '@/shared/meshProtocol';

import { errLikeToLogString } from './errLikeToLogString';
import type { GlobalMessageSearchHit } from './globalMessageSearch';
import type { ChatMessage } from './types';

/** Newest-first cap so a very long history never renders thousands of rows. */
export const UNIFIED_INBOX_LIMIT = 200;

/** Max dismissed keys kept in localStorage (oldest dropped first). */
export const UNIFIED_INBOX_DISMISSED_LIMIT = 2000;

export const UNIFIED_INBOX_DISMISSED_KEY = 'mesh-client:unifiedInbox:dismissed:v1';

const LORA_BROADCAST = 0xffffffff;

export interface UnifiedInboxItem {
  /** Stable across protocols: `<protocol>:<starId>`. */
  key: string;
  protocol: MeshProtocol;
  /** Same id ChatPanel uses for starring (`msg.id` or `<timestamp>-<packetId|x>`). */
  starId: string;
  /** Conversation view key (`ch:<n>` / `dm:<peer>`), matches ChatPanel starred entries. */
  viewKey: string;
  message: ChatMessage;
  isDirectMessage: boolean;
}

/** Same derivation as ChatPanel `msgStarId` so inbox stars and chat stars dedupe. */
export function messageStarId(msg: ChatMessage): string {
  return msg.id != null ? String(msg.id) : `${msg.timestamp}-${msg.packetId ?? 'x'}`;
}

export function inboxItemKey(protocol: MeshProtocol, msg: ChatMessage): string {
  return `${protocol}:${messageStarId(msg)}`;
}

function isDirect(protocol: MeshProtocol, msg: ChatMessage): boolean {
  // Reticulum LXMF chat has no channel concept: every row is a peer conversation.
  if (protocol === 'reticulum') return true;
  return msg.to != null && msg.to !== 0 && msg.to !== LORA_BROADCAST;
}

export interface BuildUnifiedInboxOptions {
  messagesByProtocol: Readonly<Record<MeshProtocol, readonly ChatMessage[]>>;
  enabledProtocols: readonly MeshProtocol[];
  ownNodeIdsByProtocol?: Partial<Record<MeshProtocol, ReadonlySet<number>>>;
  dismissed?: ReadonlySet<string>;
  protocolFilter?: MeshProtocol | 'all';
  /** Case-insensitive match on payload or sender name. */
  textQuery?: string;
  limit?: number;
}

/**
 * Received messages from every enabled protocol, newest first.
 * Excludes own sends, reaction/tapback rows, and rows dismissed from the inbox.
 */
export function buildUnifiedInboxItems(opts: BuildUnifiedInboxOptions): UnifiedInboxItem[] {
  const limit = opts.limit ?? UNIFIED_INBOX_LIMIT;
  const q = opts.textQuery?.trim().toLowerCase() ?? '';
  const filter = opts.protocolFilter ?? 'all';
  const items: UnifiedInboxItem[] = [];

  for (const protocol of opts.enabledProtocols) {
    if (filter !== 'all' && filter !== protocol) continue;
    const own = opts.ownNodeIdsByProtocol?.[protocol];
    for (const msg of opts.messagesByProtocol[protocol]) {
      if (own?.has(msg.sender_id >>> 0)) continue;
      if (msg.emoji && (msg.replyId != null || msg.reticulum_reply_to_hash)) continue;
      if (!msg.payload) continue;
      const key = inboxItemKey(protocol, msg);
      if (opts.dismissed?.has(key)) continue;
      if (q && !msg.payload.toLowerCase().includes(q) && !msg.sender_name.toLowerCase().includes(q))
        continue;
      const isDirectMessage = isDirect(protocol, msg);
      items.push({
        key,
        protocol,
        starId: messageStarId(msg),
        viewKey: isDirectMessage ? `dm:${msg.sender_id}` : `ch:${msg.channel}`,
        message: msg,
        isDirectMessage,
      });
    }
  }

  items.sort((a, b) => b.message.timestamp - a.message.timestamp);
  return items.slice(0, limit);
}

/**
 * Adapt an inbox row to the global-search hit shape so App can reuse
 * `handleGlobalMessageSearchHit` (openChatFromNotification + pending message focus).
 */
export function inboxItemToJumpTarget(item: UnifiedInboxItem): GlobalMessageSearchHit {
  const { message: m, protocol } = item;
  return {
    protocol,
    dbId: m.id ?? null,
    timestamp: m.timestamp,
    senderId: m.sender_id,
    senderName: m.sender_name,
    payload: m.payload,
    channel: item.isDirectMessage ? null : m.channel,
    dmPeer: protocol === 'reticulum' ? null : item.isDirectMessage ? m.sender_id : null,
    reticulumPeerHash:
      protocol === 'reticulum' ? (m.reticulum_sender_hash?.toLowerCase() ?? null) : null,
    reticulumMessageHash: m.reticulum_message_hash?.toLowerCase() ?? null,
    packetId: m.packetId ?? null,
  };
}

export interface InboxLineLabels {
  protocolLabel: string;
  conversationLabel: string;
}

/** One plain-text line per message for clipboard copy. */
export function formatInboxItemLine(
  item: UnifiedInboxItem,
  labels: InboxLineLabels,
  formatTime: (ts: number) => string,
): string {
  const { message: m } = item;
  return `[${formatTime(m.timestamp)}] [${labels.protocolLabel}] ${m.sender_name} (${labels.conversationLabel}): ${m.payload}`;
}

/** Rows for `chat:export` (the format has no protocol column, so it is tagged on the sender). */
export function inboxItemsToExportMessages(
  items: readonly UnifiedInboxItem[],
  protocolLabel: (p: MeshProtocol) => string,
): {
  timestamp: number;
  sender_name: string;
  payload: string;
  channel: number;
  to?: number;
}[] {
  return items.map((item) => ({
    timestamp: item.message.timestamp,
    sender_name: `${item.message.sender_name} [${protocolLabel(item.protocol)}]`,
    payload: item.message.payload,
    channel: item.message.channel,
    ...(item.message.to != null ? { to: item.message.to } : {}),
  }));
}

/* ── Dismissed (delete-local) persistence ───────────────────────────────────────────────── */

/**
 * Load inbox keys the user removed locally. Failure point: localStorage read/parse can throw;
 * fallback is an empty set (everything reappears) and a debug log.
 */
export function loadDismissedInboxKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(UNIFIED_INBOX_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string' && k.length > 0));
  } catch (e) {
    console.debug('[unifiedInbox] load dismissed failed ' + errLikeToLogString(e));
    return new Set();
  }
}

/**
 * Persist dismissed keys (newest kept when over the cap). Returns false on write failure so the
 * caller can leave its in-memory set unchanged and the previous document stays intact.
 */
export function saveDismissedInboxKeys(keys: ReadonlySet<string>): boolean {
  try {
    const all = [...keys];
    const capped =
      all.length > UNIFIED_INBOX_DISMISSED_LIMIT ? all.slice(-UNIFIED_INBOX_DISMISSED_LIMIT) : all;
    localStorage.setItem(UNIFIED_INBOX_DISMISSED_KEY, JSON.stringify(capped));
    return true;
  } catch (e) {
    console.debug('[unifiedInbox] save dismissed failed ' + errLikeToLogString(e));
    return false;
  }
}

/** Ctrl/Cmd+Shift+U — unified inbox. */
export function isUnifiedInboxShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  platform: string,
): boolean {
  const mod = platform === 'darwin' ? e.metaKey : e.ctrlKey;
  return mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u';
}
