export class RepetitiveAiOutputError extends Error {
  constructor() {
    super('repetitiveOutput');
  }
}

const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{S}]/gu, '');

/** Detect sustained output loops, rather than normal reuse of a callsign or radio term. */
export function hasRepetitiveAiOutput(text: string): boolean {
  const sentences = new Map<string, number>();
  for (const sentence of text.slice(-8192).split(/[.!?。！？\n]+/u)) {
    const key = normalize(sentence);
    if (Array.from(key).length < 20) continue;
    const count = (sentences.get(key) ?? 0) + 1;
    if (count >= 5) return true;
    sentences.set(key, count);
  }
  const chars = Array.from(normalize(text.slice(-8192))).slice(-4096);
  for (let start = 0; start + 72 <= chars.length; start++) {
    for (let width = 1; width <= 64 && start + width * 6 <= chars.length; width++) {
      let length = width;
      while (
        start + length < chars.length &&
        chars[start + length] === chars[start + (length % width)]
      ) {
        length++;
        if (length >= 72 && length >= width * 6) return true;
      }
    }
  }
  return false;
}
