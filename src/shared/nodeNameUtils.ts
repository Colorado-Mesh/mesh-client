/**
 * Meshtastic node identity helpers. Firmware and client placeholders use
 * hex-derived short names (last 4 of node id); when a real long name exists we
 * clear that default so the UI prefers long_name.
 */

/**
 * When merging protobuf User / NodeInfo fields, `""` is not nullish and would
 * otherwise overwrite stored names. Prefer trimmed non-empty input; else fallback.
 * Optionally checks for legacy placeholder names (!xxxxxxxx) and treats them as empty.
 */
export function preferNonEmptyTrimmedString(
  preferred: string | undefined | null,
  fallback: string,
  options?: { nodeId?: number },
): string {
  const t = (preferred === '' ? undefined : preferred)?.trim();
  if (!t) return fallback;
  if (options?.nodeId && isPlaceholderLongName(t, options.nodeId)) return fallback;
  return t;
}

export function isPlaceholderLongName(longName: string, nodeId: number): boolean {
  const expected = `!${(nodeId >>> 0).toString(16).padStart(8, '0')}`;
  return longName.trim().toLowerCase() === expected.toLowerCase();
}

/** True when we still need real identity (empty or !xxxxxxxx placeholder long_name). */
export function meshtasticNodeLacksDisplayIdentity(
  node: { long_name?: string } | undefined,
  nodeId: number,
): boolean {
  if (!node) return true;
  const ln = (node.long_name ?? '').trim();
  if (!ln) return true;
  return isPlaceholderLongName(ln, nodeId);
}

/** True when shortName matches the firmware/client default (last 4 hex of node id). */
export function isDefaultShortName(shortName: string, nodeId: number): boolean {
  if (!shortName.trim()) return false;
  const suffix = (nodeId >>> 0).toString(16).padStart(8, '0').slice(-4);
  return shortName.trim().toLowerCase() === suffix.toLowerCase();
}

/**
 * If we have a non-placeholder long name but short_name is only the device-id
 * suffix, return '' so callers fall back to long_name in the UI.
 */
export function meshtasticShortNameAfterClearingDefault(
  longName: string,
  shortName: string,
  nodeId: number,
): string {
  if (isPlaceholderLongName(longName, nodeId)) return shortName;
  if (isDefaultShortName(shortName, nodeId)) return '';
  return shortName;
}
