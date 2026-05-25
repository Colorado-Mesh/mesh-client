import { splitChannelPskLine } from '@/shared/meshtasticChannelPskLine';

export type ChannelPskValidation = 'ok' | 'invalidBase64' | 'invalidLength';

export interface ManualChannelPublishEntry {
  name: string;
  index?: number;
  psk: Uint8Array;
}

/** Split manual MQTT channel PSK input on newlines or commas. */
export function parseChannelPskInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Format stored channel PSK entries for the textarea display. */
export function formatChannelPskInput(entries: string[] | undefined): string {
  return (entries ?? []).join('\n');
}

function decodePskBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function decodeChannelPskBase64(line: string): Uint8Array {
  const split = splitChannelPskLine(line);
  if (!split) throw new Error('empty channel PSK line');
  return decodePskBase64(split.b64);
}

/** Validate parsed channel PSK lines (base64 decode + AES key length). */
export function validateChannelPskEntries(lines: string[]): ChannelPskValidation {
  if (lines.length === 0) return 'ok';
  for (const line of lines) {
    try {
      const raw = decodeChannelPskBase64(line);
      if (raw.length === 16 || raw.length === 32 || raw.length < 16) continue;
      return 'invalidLength';
    } catch {
      // catch-no-log-ok invalid base64 on blur — user-facing warning only
      return 'invalidBase64';
    }
  }
  return 'ok';
}

/** Parse `ChannelName=base64` or `ChannelName@index=base64` for MQTT publish (named lines only). */
export function parseManualChannelPublishEntry(line: string): ManualChannelPublishEntry | null {
  const split = splitChannelPskLine(line);
  if (split?.kind !== 'named') return null;
  try {
    const psk = decodePskBase64(split.b64);
    if (psk.length !== 16 && psk.length !== 32 && psk.length >= 16) return null;
    return { name: split.name, index: split.index, psk };
  } catch {
    // catch-no-log-ok invalid base64 on a named publish line — skip entry
    return null;
  }
}

export function parseManualChannelPublishEntries(lines: string[]): ManualChannelPublishEntry[] {
  const entries: ManualChannelPublishEntry[] = [];
  for (const line of lines) {
    const parsed = parseManualChannelPublishEntry(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}
