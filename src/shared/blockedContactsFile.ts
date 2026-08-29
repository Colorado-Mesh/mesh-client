/**
 * Pure serialization / parsing for blocked-contact export files.
 *
 * Kept free of Electron and DOM imports so both the main-process file handlers and
 * unit tests can use it directly (`src/main/index.ts` is too heavy to import in tests).
 */
import { isValidBlockedContactHash, normalizeBlockedHash } from './blockedContactHash';

/** Shape written by export; `blocked` is also accepted on import. */
export interface BlockedContactsFilePayload {
  version: 1;
  protocol: string;
  exported_at: string;
  blocked: string[];
}

export interface ParsedBlockedContactsFile {
  /** Normalized, de-duplicated, strictly valid hashes in first-seen order. */
  hashes: string[];
  /** Entries rejected as malformed or duplicated. */
  skipped: number;
}

export function serializeBlockedContacts(
  hashes: readonly string[],
  protocol = 'reticulum',
): string {
  const payload: BlockedContactsFilePayload = {
    version: 1,
    protocol,
    exported_at: new Date().toISOString(),
    blocked: hashes.map(normalizeBlockedHash),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

/** Collect candidate entries out of any supported container shape. */
function candidateEntries(raw: string): unknown[] | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // catch-no-log-ok malformed JSON is reported to the caller as a parse failure
      return null;
    }
    if (Array.isArray(parsed)) return parsed as unknown[];
    if (parsed && typeof parsed === 'object') {
      const blocked = (parsed as { blocked?: unknown }).blocked;
      if (Array.isArray(blocked)) return blocked as unknown[];
      return null;
    }
    return null;
  }
  // Plain text: newline and/or comma delimited, tolerating CRLF and blank lines.
  return trimmed
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Parse an export file. Returns `null` when the container itself is unreadable, so the
 * caller can distinguish "bad file" from "file with zero valid entries".
 */
export function parseBlockedContactsFile(raw: string): ParsedBlockedContactsFile | null {
  const entries = candidateEntries(raw);
  if (entries === null) return null;

  const seen = new Set<string>();
  const hashes: string[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!isValidBlockedContactHash(entry)) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeBlockedHash(entry as string);
    if (seen.has(normalized)) {
      skipped += 1;
      continue;
    }
    seen.add(normalized);
    hashes.push(normalized);
  }
  return { hashes, skipped };
}
