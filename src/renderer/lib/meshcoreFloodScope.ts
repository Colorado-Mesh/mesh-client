import { meshCoreRegionKeyFromName } from '@/shared/meshcoreRfPacketParse';

import type { MeshCoreConnection } from './meshcore/meshcoreHookTypes';

/** Normalize user hashtag input to `#name` form (meshcore.js convention). */
export function normalizeMeshcoreFloodScopeHashtag(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Derive 16-byte flood-scope transport key from a hashtag. */
export async function meshcoreFloodScopeKeyFromHashtag(
  hashtag: string,
): Promise<Uint8Array | null> {
  const normalized = normalizeMeshcoreFloodScopeHashtag(hashtag);
  if (!normalized || normalized === '#') return null;
  return meshCoreRegionKeyFromName(normalized);
}

/** Apply flood scope on radio; empty hashtag clears scope. */
export async function applyMeshcoreFloodScope(
  conn: Pick<MeshCoreConnection, 'setFloodScope' | 'clearFloodScope'>,
  hashtag: string,
): Promise<void> {
  const key = await meshcoreFloodScopeKeyFromHashtag(hashtag);
  if (!key) {
    await conn.clearFloodScope();
    return;
  }
  await conn.setFloodScope(key);
}

export const MESHCORE_FLOOD_SCOPE_PRESETS = ['#colorado', '#denver'] as const;
