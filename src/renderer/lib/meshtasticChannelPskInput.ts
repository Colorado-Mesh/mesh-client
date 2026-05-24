export type ChannelPskValidation = 'ok' | 'invalidBase64' | 'invalidLength';

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

function decodeChannelPskBase64(line: string): Uint8Array {
  const trimmed = line.trim();
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    const name = trimmed.slice(0, eq).trim();
    const b64 = trimmed.slice(eq + 1).trim();
    // Match mqtt-manager parseChannelPskLine: names lack +/= (padding is only in base64).
    if (name.length > 0 && b64.length > 0 && !/[+/=]/.test(name)) {
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
