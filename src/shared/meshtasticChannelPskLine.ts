/** Left side of `ChannelName=base64` or `ChannelName@0..7=base64` (names lack +/=/@ in the name body). */
const NAMED_CHANNEL_PSK_LEFT = /^([A-Za-z0-9_-]+)(@[0-7])?$/;

export type SplitChannelPskLine =
  | { kind: 'named'; name: string; index?: number; b64: string }
  | { kind: 'bare'; b64: string };

/**
 * Split a manual MQTT channel PSK line.
 * Named: first `=` only when left side matches ChannelName or ChannelName@index;
 * everything after that `=` is the full base64 value (including trailing `=` padding).
 * Otherwise treat the whole trimmed line as bare base64.
 */
export function splitChannelPskLine(line: string): SplitChannelPskLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    const left = trimmed.slice(0, eq).trim();
    const match = NAMED_CHANNEL_PSK_LEFT.exec(left);
    if (match) {
      const name = match[1];
      const indexPart = match[2];
      const index = indexPart !== undefined ? parseInt(indexPart.slice(1), 10) : undefined;
      const b64 = trimmed.slice(eq + 1);
      if (indexPart !== undefined || b64.length > 0) {
        return { kind: 'named', name, index, b64 };
      }
    }
  }

  return { kind: 'bare', b64: trimmed };
}
