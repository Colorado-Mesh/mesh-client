import { meshcoreConfiguredChannelIndexSet } from './meshcoreConfiguredChatChannels';
import { MESHCORE_CHANNEL_INDEX_MAX, MESHCORE_CHANNEL_NAME_MAX_LEN } from './meshcoreUtils';

export function normalizeMeshcoreHashtagChannelName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function isValidMeshcoreHashtagChannelName(value: string): boolean {
  const normalized = normalizeMeshcoreHashtagChannelName(value);
  return normalized.length > 1 && normalized.length <= MESHCORE_CHANNEL_NAME_MAX_LEN;
}

export function findFirstFreeMeshcoreChannelIndex(
  channels: readonly { index: number; name: string; secret?: Uint8Array }[],
): number | null {
  const used = meshcoreConfiguredChannelIndexSet(channels);
  for (let index = 0; index <= MESHCORE_CHANNEL_INDEX_MAX; index += 1) {
    if (!used.has(index)) return index;
  }
  return null;
}
