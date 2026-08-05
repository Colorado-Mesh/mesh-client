/** Cap for @/Tab nick completion dropdown. */
export const RRC_NICK_COMPLETE_CAP = 8;

export interface RrcAtMentionAtCaret {
  /** Index of `@` in `text`. */
  start: number;
  /** Text after `@` up to caret (no spaces). */
  query: string;
}

/**
 * Collect nick labels from room members (nickname preferred; skip blank).
 */
export function rrcMemberNickLabels(
  members: readonly { nickname?: string | null; identity_hash: string }[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const nick = m.nickname?.trim();
    const label = nick || '';
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Case-insensitive prefix match; empty query returns up to `cap` nicks. */
export function listRrcNickCompleteCandidates(
  nicks: readonly string[],
  query: string,
  cap = RRC_NICK_COMPLETE_CAP,
): string[] {
  const q = query.trim().toLowerCase();
  const results: string[] = [];
  for (const nick of nicks) {
    if (!nick.trim()) continue;
    if (q && !nick.toLowerCase().startsWith(q)) continue;
    results.push(nick);
    if (results.length >= cap) break;
  }
  return results;
}

/**
 * Find `@query` immediately before `caret` (IRC-style; query has no whitespace).
 */
export function findRrcAtMentionAtCaret(text: string, caret: number): RrcAtMentionAtCaret | null {
  const pos = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, pos);
  const m = /(^|[\s])@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  return { start, query: m[2] };
}

export interface RrcNickInsertResult {
  text: string;
  caret: number;
}

/** Replace `@query` at `start` with `@nick ` (plain IRC — not `@[Name]`). */
export function insertRrcNickMention(
  text: string,
  start: number,
  queryLen: number,
  nick: string,
): RrcNickInsertResult {
  const insert = `@${nick} `;
  const before = text.slice(0, start);
  let after = text.slice(start + 1 + Math.max(0, queryLen));
  // Absorb one leading space so Tab cycles (`@Zeva ` → `@Bob `) do not stack spaces.
  if (after.startsWith(' ')) after = after.slice(1);
  const next = before + insert + after;
  return { text: next, caret: before.length + insert.length };
}

/**
 * Cycle Tab completion through `candidates` (Shift-Tab = reverse).
 * `currentNick` is the nick already inserted (without `@`), or null on first Tab.
 */
export function nextRrcNickCompleteIndex(
  candidates: readonly string[],
  currentIndex: number,
  reverse: boolean,
): number {
  if (candidates.length === 0) return -1;
  if (currentIndex < 0) return reverse ? candidates.length - 1 : 0;
  if (reverse) {
    return (currentIndex - 1 + candidates.length) % candidates.length;
  }
  return (currentIndex + 1) % candidates.length;
}

export interface BuildRrcWhisperCompleteMembersOpts {
  lastWhisperPeer: { identity_hash: string; nickname?: string | null } | null;
  messages: readonly {
    kind: string;
    nickname?: string | null;
    sender_hash?: string | null;
    dst_hash?: string | null;
  }[];
  localIdentityHash?: string | null;
  selfNickname?: string | null;
}

/**
 * Nick candidates for @/Tab completion in the synthetic [whispers] room
 * (no hub roster — peers come from last whisper + transcript senders).
 */
export function buildRrcWhisperCompleteMembers(
  opts: BuildRrcWhisperCompleteMembersOpts,
): { identity_hash: string; nickname?: string | null }[] {
  const byHash = new Map<string, { identity_hash: string; nickname?: string | null }>();
  const local = opts.localIdentityHash?.trim().toLowerCase() || null;

  const upsert = (identity_hash: string, nickname?: string | null) => {
    const hash = identity_hash.trim().toLowerCase();
    if (!hash) return;
    const nick = nickname?.trim() || null;
    const prev = byHash.get(hash);
    if (prev) {
      if (!prev.nickname?.trim() && nick) {
        byHash.set(hash, { identity_hash: hash, nickname: nick });
      }
      return;
    }
    byHash.set(hash, { identity_hash: hash, nickname: nick });
  };

  if (opts.lastWhisperPeer?.identity_hash.trim()) {
    upsert(opts.lastWhisperPeer.identity_hash, opts.lastWhisperPeer.nickname);
  }

  for (const msg of opts.messages) {
    if (msg.kind === 'system' && msg.dst_hash?.trim()) {
      upsert(msg.dst_hash, msg.nickname);
      continue;
    }
    if ((msg.kind === 'notice' || msg.kind === 'msg' || msg.kind === 'action') && msg.sender_hash) {
      const sender = msg.sender_hash.trim().toLowerCase();
      if (local && sender === local) continue;
      upsert(sender, msg.nickname);
    }
  }

  const selfNick = opts.selfNickname?.trim() || null;
  if (selfNick) {
    upsert(local ?? `nick:${selfNick.toLowerCase()}`, selfNick);
  }

  return [...byHash.values()].filter((m) => Boolean(m.nickname?.trim()));
}
