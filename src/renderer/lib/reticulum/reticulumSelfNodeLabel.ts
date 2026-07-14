import { isReticulumHashPrefixAlias } from '@/renderer/lib/ingest/reticulumIngest';
import { sanitizeReticulumDisplayName } from '@/shared/reticulumDisplayName';

export interface ReticulumSelfLabelParts {
  identityDisplayName?: string | null;
  lxmfHash?: string | null;
  storedLongName?: string | null;
}

/**
 * Prefer Network identity display_name; ignore hash-prefix stubs in nodeStore longName.
 * Returns undefined when there is no real configured name.
 */
export function resolveReticulumSelfDisplayName(
  parts: ReticulumSelfLabelParts,
): string | undefined {
  const hash = parts.lxmfHash?.replace(/[^0-9a-f]/gi, '').toLowerCase() ?? '';
  const fromIdentity = sanitizeReticulumDisplayName(parts.identityDisplayName);
  if (fromIdentity && (!hash || !isReticulumHashPrefixAlias(hash, fromIdentity))) {
    return fromIdentity;
  }
  const stored = sanitizeReticulumDisplayName(parts.storedLongName);
  if (stored && hash && !isReticulumHashPrefixAlias(hash, stored)) {
    return stored;
  }
  return undefined;
}

/** App header label: real display name only (empty → omit `Node:`). */
export function resolveReticulumSelfHeaderLabel(parts: ReticulumSelfLabelParts): string {
  return resolveReticulumSelfDisplayName(parts) ?? '';
}

/** Chat / diagnostics fallback when no display name is configured. */
export function resolveReticulumSelfFullLabel(
  parts: ReticulumSelfLabelParts,
  fallbackNodeId?: number,
): string {
  const name = resolveReticulumSelfDisplayName(parts);
  if (name) return name;
  const hash = parts.lxmfHash?.replace(/[^0-9a-f]/gi, '').toLowerCase() ?? '';
  if (hash) return hash.slice(0, 12);
  if (fallbackNodeId != null && fallbackNodeId > 0) {
    return fallbackNodeId.toString(16).toUpperCase();
  }
  return '';
}
