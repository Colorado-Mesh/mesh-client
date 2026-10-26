/** Longest quote of the message a reaction answers, in characters, before it is cut. */
export const TAK_REPLY_QUOTE_MAX = 32;
const ELLIPSIS = '…';

/** What a heard reply or reaction answers, for the line TAK clients see. */
export interface TakReplyContext {
  /** A reaction: its text is the emoji alone. */
  reaction: boolean;
  /** Name of the sender of the message it answers. */
  to?: string;
  /** Text of the message it answers; quoted for a reaction, which says nothing else. */
  quote?: string;
}

/** `raw` on one line, cut to {@link TAK_REPLY_QUOTE_MAX} characters with an ellipsis. */
function shortQuote(raw: string | undefined): string {
  const flat = (raw ?? '').replace(/\s+/gu, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= TAK_REPLY_QUOTE_MAX) return flat;
  return (
    chars
      .slice(0, TAK_REPLY_QUOTE_MAX - 1)
      .join('')
      .trimEnd() + ELLIPSIS
  );
}

/**
 * The text TAK clients see for a heard message. ATAK shows each line on its own, from its
 * sender, so a reply says whom it answers (`@Alice copy that`) and a reaction what it reacts to
 * (`👍 to Alice: "meet at the trailhead…"`). Anything else, or a reply whose target is not
 * known, is passed on as it is.
 */
export function formatTakReplyText(text: string, reply: TakReplyContext | undefined): string {
  const to = reply?.to?.trim();
  if (!reply || !to) return text;
  if (!reply.reaction) return `@${to} ${text}`;
  const quote = shortQuote(reply.quote);
  return quote ? `${text} to ${to}: "${quote}"` : `${text} to ${to}`;
}
