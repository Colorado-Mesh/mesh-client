/**
 * Replies on a MeshCore channel, typed in ATAK. MeshCore has no reply-to-message feature: the apps
 * start a reply with `@[Name]`, and the firmware sends that like any other text. ATAK's chat has no
 * reply action either, so a reply is typed:
 *
 * - `@silver are you on?` sends `@[Silver Eagle] are you on?`, when exactly one person heard on
 *   that channel recently has a name starting with "silver". Case, spaces, emoji and punctuation are
 *   ignored when matching, so `@w0rmt` finds `🔥 W0RMT 03`. A name that matches exactly wins over
 *   longer names it starts. `@"Two Words"` matches a whole name with a space in it.
 * - `@@ thanks` replies to whoever spoke last on that channel.
 *
 * When several people match, nothing is sent and the caller says who matched, so a reply never goes
 * to the wrong person. Nothing is sent either for a name the marker cannot hold (one with `]`). When nobody matches, the text is sent exactly as typed, so a message that
 * just starts with "@" is not changed by surprise. Text already in the `@[Name]` form is left alone.
 *
 * The same rules as MeshCore TAK Bridge (`ChannelReplies` in Colorado-Mesh/meshcore-kotlin), so a
 * reply typed in ATAK works the same through either. Senders are remembered per channel by when
 * this side heard them, not by the sender's clock, which may be wrong.
 */

export type ChannelReplyOutcome =
  /** Send `text`; `repliedTo` is the name it was addressed to, unset when it is unchanged. */
  | { kind: 'send'; text: string; repliedTo?: string; message?: string }
  /** `typed` matches several `names`, most recently heard first; send nothing. */
  | { kind: 'ambiguous'; typed: string; names: string[] }
  /** `@@` was used, but nobody has been heard on the channel recently; send nothing. */
  | { kind: 'nobody' }
  /** The reply is for `name`, which `@[…]` cannot hold (it has a `]`); send nothing. */
  | { kind: 'unencodable'; name: string };

/** MeshCore names are at most 32 bytes; a little slack for multi-byte characters. */
const MAX_NAME_CHARS = 40;
const DEFAULT_MAX_NAMES_PER_CHANNEL = 50;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Lower case, letters and digits only, so emoji, spaces and punctuation do not matter. Composed
 * first (NFC), so an accented letter typed as one character matches one sent as a letter and a
 * combining accent.
 */
export function normalizeReplyName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Whether `name` fits MeshCore's `@[Name]` marker: apps read the name up to the first `]`, so a
 * name with one would be cut short and the rest would spill into the message.
 */
function fitsReplyMarker(name: string): boolean {
  return !name.includes(']');
}

/** The reply to `name`, or an outcome saying it cannot be written. */
function replyTo(name: string, rest: string): ChannelReplyOutcome {
  if (!fitsReplyMarker(name)) return { kind: 'unencodable', name };
  return { kind: 'send', ...mention(name, rest), repliedTo: name };
}

function mention(name: string, rest: string): { text: string; message: string } {
  const message = rest.trim();
  return { text: message ? `@[${name}] ${message}` : `@[${name}]`, message };
}

/** The typed name and the message after it, from the text after "@"; null for an open quote. */
function splitTyped(afterAt: string): [string, string] | null {
  if (afterAt.startsWith('"')) {
    const close = afterAt.indexOf('"', 1);
    if (close < 0) return null;
    return [afterAt.slice(1, close), afterAt.slice(close + 1)];
  }
  const space = afterAt.search(/\s/u);
  const end = space < 0 ? afterAt.length : space;
  return [afterAt.slice(0, end), afterAt.slice(end)];
}

export class ChannelReplies {
  /** Per channel key, each sender's name and when it was last heard, least recent first. */
  private readonly heardBy = new Map<string, Map<string, number>>();

  constructor(
    private readonly maxNamesPerChannel: number = DEFAULT_MAX_NAMES_PER_CHANNEL,
    private readonly maxAgeMs: number = DEFAULT_MAX_AGE_MS,
  ) {}

  /** Remember the sender of a message heard on a channel. */
  heard(channelKey: string, senderName: string, atMs: number): void {
    const name = senderName.trim();
    if (!name || name.length > MAX_NAME_CHARS) return;
    let names = this.heardBy.get(channelKey);
    if (!names) {
      names = new Map();
      this.heardBy.set(channelKey, names);
    }
    names.delete(name);
    names.set(name, atMs);
    while (names.size > this.maxNamesPerChannel) {
      const oldest = names.keys().next().value;
      if (oldest === undefined) break;
      names.delete(oldest);
    }
  }

  /** Forget everyone, for example when the server stops. */
  clear(): void {
    this.heardBy.clear();
  }

  /** Names heard on a channel recently, most recent first. */
  recent(channelKey: string, nowMs: number): string[] {
    const names = this.heardBy.get(channelKey);
    if (!names) return [];
    return [...names]
      .filter(([, at]) => nowMs - at <= this.maxAgeMs)
      .map(([name]) => name)
      .reverse();
  }

  /** What to send for `text`, typed in ATAK for a channel. */
  resolve(channelKey: string, text: string, nowMs: number): ChannelReplyOutcome {
    if (!text.startsWith('@') || text.startsWith('@[')) return { kind: 'send', text };
    const recent = this.recent(channelKey, nowMs);
    if (text === '@@' || (text.startsWith('@@') && /\s/u.test(text[2]))) {
      const last = recent.at(0);
      if (last === undefined) return { kind: 'nobody' };
      // Never an older speaker in their place: the reply would go to someone not meant.
      return replyTo(last, text.slice(2));
    }
    const split = splitTyped(text.slice(1));
    if (!split) return { kind: 'send', text };
    const [typed, rest] = split;
    const key = normalizeReplyName(typed);
    if (!key) return { kind: 'send', text };
    const exact = recent.filter((n) => normalizeReplyName(n) === key);
    const matches =
      exact.length === 1 ? exact : recent.filter((n) => normalizeReplyName(n).startsWith(key));
    if (matches.length === 0) return { kind: 'send', text };
    if (matches.length > 1) return { kind: 'ambiguous', typed, names: matches };
    return replyTo(matches[0], rest);
  }
}
