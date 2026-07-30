/**
 * Normalizers for loosely-typed packet payloads that reach the UI.
 *
 * Module-port and Store & Forward events carry `unknown` data because the shape
 * differs per firmware port; these helpers coerce the common carriers into the
 * bytes/text the panels expect instead of each call site re-implementing the
 * same `instanceof` ladder.
 */

function isNumberByteArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((b) => typeof b === 'number');
}

function bytesFromObjectWrapper(value: object, visited: Set<object>): Uint8Array | null {
  if (visited.has(value)) return new Uint8Array();
  visited.add(value);
  const wrapper = value as { raw?: unknown; data?: unknown; payload?: unknown };
  for (const nested of [wrapper.raw, wrapper.data, wrapper.payload]) {
    if (nested === undefined) continue;
    const bytes = toPacketPayloadBytesInner(nested, visited);
    if (bytes.length > 0) return bytes;
  }
  return null;
}

/**
 * Coerce a decoded module payload into bytes. Accepts a `Uint8Array`, a wrapper
 * carrying one under `raw` / `data` / `payload`, an `ArrayBuffer`, or a byte
 * array. Anything else yields an empty array rather than throwing — these
 * payloads feed display-only panels.
 */
export function toPacketPayloadBytes(value: unknown): Uint8Array {
  return toPacketPayloadBytesInner(value, new Set<object>());
}

function toPacketPayloadBytesInner(value: unknown, visited: Set<object>): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (isNumberByteArray(value)) return Uint8Array.from(value);
  if (value && typeof value === 'object') {
    return bytesFromObjectWrapper(value, visited) ?? new Uint8Array();
  }
  return new Uint8Array();
}

/**
 * Clamp untrusted text to `maxLength` code units for display surfaces (OS
 * notifications, log lines). Callers must sanitize control characters first.
 */
export function truncatePacketText(text: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  return text.length > limit ? text.slice(0, limit) : text;
}
