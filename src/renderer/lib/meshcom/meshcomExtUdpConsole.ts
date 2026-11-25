/**
 * Strip `[EXT] Out:` / `[EXT] Tele-Out:` wrappers from NET Console / serial ExtUDP logs.
 */

/** Return the JSON object substring from an ExtUDP console line, or null. */
export function extractMeshcomExtUdpConsoleJson(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    const end = trimmed.lastIndexOf('}');
    if (end > 0) return trimmed.slice(0, end + 1);
    return null;
  }
  // [EXT] Out: {...} Len: N   /  [EXT] Tele-Out: {...} Len: N
  const tagged = /^\[EXT\]\s+(?:Tele-Out|Out):\s*/i.exec(trimmed);
  if (!tagged) return null;
  const rest = trimmed.slice(tagged[0].length);
  const start = rest.indexOf('{');
  if (start < 0) return null;
  const end = rest.lastIndexOf('}');
  if (end <= start) return null;
  return rest.slice(start, end + 1);
}
