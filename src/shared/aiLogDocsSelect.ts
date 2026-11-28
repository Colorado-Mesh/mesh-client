const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export interface MarkdownSection {
  /** Heading text without leading # markers. */
  title: string;
  /** Full section including the heading line. */
  body: string;
  level: number;
}

/** Split markdown into ## / ### sections (level 2–3). Leading preamble is dropped. */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const line of lines) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    const hashes = match?.[1];
    const title = match?.[2];
    if (hashes && title) {
      if (current) sections.push(current);
      current = { title: title.trim(), body: line, level: hashes.length };
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  if (current) sections.push(current);
  return sections;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens from category ids (ble-connection → ble, connection) and free text. */
export function tokensFromFindings(values: string[]): Set<string> {
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    for (const part of normalized.split(/\s+/)) {
      if (part.length >= 3) out.add(part);
    }
  }
  return out;
}

function sectionScore(section: MarkdownSection, tokens: Set<string>): number {
  if (tokens.size === 0) return 0;
  const hay = normalizeToken(`${section.title}\n${section.body}`);
  let score = 0;
  for (const token of tokens) {
    if (!hay.includes(token)) continue;
    score += section.title.toLowerCase().includes(token) ? 3 : 1;
  }
  return score;
}

/**
 * Prefer heading sections that match finding tokens; fill remaining budget with
 * highest-scoring leftovers. Returns empty string when nothing fits.
 */
export function selectDocsExcerpts(
  markdown: string,
  findingHints: string[],
  maxBytes: number,
): { text: string; truncated: boolean; sectionCount: number } {
  if (maxBytes <= 0) return { text: '', truncated: true, sectionCount: 0 };
  const sections = splitMarkdownSections(markdown);
  if (sections.length === 0) {
    const clipped = clipUtf8(markdown.trim(), maxBytes);
    return {
      text: clipped.text,
      truncated: clipped.truncated || clipped.text.length < markdown.trim().length,
      sectionCount: clipped.text ? 1 : 0,
    };
  }
  const tokens = tokensFromFindings(findingHints);
  const ranked = sections
    .map((section, index) => ({ section, index, score: sectionScore(section, tokens) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen: MarkdownSection[] = [];
  let used = 0;
  let truncated = false;
  for (const row of ranked) {
    if (row.score === 0 && chosen.length > 0) break;
    const piece = row.section.body.trim();
    if (!piece) continue;
    const bytes = utf8Bytes(piece) + (chosen.length ? 2 : 0);
    if (used + bytes > maxBytes) {
      truncated = true;
      if (chosen.length === 0) {
        const clipped = clipUtf8(piece, maxBytes);
        if (clipped.text) {
          return { text: clipped.text, truncated: true, sectionCount: 1 };
        }
      }
      continue;
    }
    chosen.push(row.section);
    used += bytes;
  }

  // Preserve document order for readability.
  chosen.sort((a, b) => sections.indexOf(a) - sections.indexOf(b));
  const text = chosen.map((s) => s.body.trim()).join('\n\n');
  truncated = truncated || chosen.length < sections.length;
  return { text, truncated, sectionCount: chosen.length };
}

function clipUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8Bytes(value) <= maxBytes) return { text: value, truncated: false };
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Bytes(value.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { text: value.slice(0, lo).trimEnd(), truncated: true };
}
