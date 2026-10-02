/**
 * `{page}.allowed` text helpers. rsNomad keeps only lines that are exactly 32
 * hex characters and silently ignores everything else, so the editor flags
 * stray lines instead of letting a typo quietly lock someone out.
 */

const ACL_HASH_RE = /^[0-9a-f]{32}$/i;

export interface NomadPageAclAnalysis {
  /** Lowercased identity hashes, in file order, without duplicates. */
  hashes: string[];
  /** 1-based line numbers that are neither blank, `#` comments, nor 32-hex hashes. */
  invalidLines: number[];
}

export function analyzeNomadPageAcl(text: string): NomadPageAclAnalysis {
  const hashes: string[] = [];
  const invalidLines: number[] = [];
  const seen = new Set<string>();
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    if (!ACL_HASH_RE.test(line)) {
      invalidLines.push(index + 1);
      return;
    }
    const hash = line.toLowerCase();
    if (seen.has(hash)) return;
    seen.add(hash);
    hashes.push(hash);
  });
  return { hashes, invalidLines };
}

/** Append `hash` on its own line unless it is already listed (case-insensitive). */
export function appendNomadPageAclHash(text: string, hash: string): string {
  const clean = hash.trim().toLowerCase();
  if (!ACL_HASH_RE.test(clean)) return text;
  if (analyzeNomadPageAcl(text).hashes.includes(clean)) return text;
  if (!text) return `${clean}\n`;
  return text.endsWith('\n') ? `${text}${clean}\n` : `${text}\n${clean}\n`;
}
