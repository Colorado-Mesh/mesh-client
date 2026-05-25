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

function stripChannelIndexFromNamePart(namePart: string): string {
  const atIdx = namePart.lastIndexOf('@');
  if (atIdx > 0) {
    const indexStr = namePart.slice(atIdx + 1);
    const parsedIndex = parseInt(indexStr, 10);
    if (Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex <= 7) {
      return namePart.slice(0, atIdx).trim();
    }
  }
  return namePart;
}

function decodeChannelPskBase64(line: string): Uint8Array {
  const trimmed = line.trim();
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    const namePart = stripChannelIndexFromNamePart(trimmed.slice(0, eq).trim());
    const b64 = trimmed.slice(eq + 1).trim();
    // Match mqtt-manager parseChannelPskLine: names lack +/=/@ (padding is only in base64).
    if (namePart.length > 0 && b64.length > 0 && !/[+/=@]/.test(namePart)) {
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }
  }
  return Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
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
  const trimmed = line.trim();
  if (!trimmed) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  let namePart = trimmed.slice(0, eq).trim();
  const b64 = trimmed.slice(eq + 1).trim();
  let index: number | undefined;
  const atIdx = namePart.lastIndexOf('@');
  if (atIdx > 0) {
    const indexStr = namePart.slice(atIdx + 1);
    const parsedIndex = parseInt(indexStr, 10);
    if (Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex <= 7) {
      index = parsedIndex;
      namePart = namePart.slice(0, atIdx).trim();
    }
  }
  const name = namePart;
  if (name.length === 0 || b64.length === 0 || /[+/=@]/.test(name)) return null;
  try {
    const psk = decodeChannelPskBase64(`${name}=${b64}`);
    // Match validateChannelPskEntries: 16/32-byte AES keys or short default-public keys only.
    if (psk.length !== 16 && psk.length !== 32 && psk.length >= 16) return null;
    return { name, index, psk };
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
