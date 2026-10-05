const ALNUM = /[\p{L}\p{N}]/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The name's first grapheme when it is an emoji (keeps ZWJ sequences, skin tones and flags whole). */
function leadingEmoji(name: string): string | undefined {
  const first = graphemes.segment(name)[Symbol.iterator]().next();
  if (first.done) return undefined;
  return PICTOGRAPHIC.test(first.value.segment) ? first.value.segment : undefined;
}

function firstAlnum(word: string): string | undefined {
  for (const ch of word) {
    if (ALNUM.test(ch)) return ch;
  }
  return undefined;
}

/**
 * Avatar text for a chat sender (Option A's sender disc). A name that starts with an emoji shows
 * that emoji ("🐻MEGABEAR" -> "🐻"). Otherwise two-character initials: the first letter or digit
 * of the first two words ("Trail Dave" -> "TD", "NV0N -Joey" -> "NJ"), else the first two of a
 * single word ("Packrat" -> "PA"). Later emoji and punctuation are skipped; a name with no letters
 * falls back to its first character, and no name at all to the last two hex digits of the node id.
 */
export function senderInitials(name: string | null | undefined, nodeId: number): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed) {
    const emoji = leadingEmoji(trimmed);
    if (emoji) return emoji;
    const words = trimmed.split(/\s+/);
    const firsts = words.map(firstAlnum).filter((ch): ch is string => ch !== undefined);
    if (firsts.length >= 2) return (firsts[0] + firsts[1]).toLocaleUpperCase();
    const letters = Array.from(trimmed).filter((ch) => ALNUM.test(ch));
    if (letters.length > 0) return letters.slice(0, 2).join('').toLocaleUpperCase();
    return Array.from(trimmed)[0] ?? '';
  }
  return (nodeId >>> 0).toString(16).padStart(2, '0').slice(-2).toUpperCase();
}
