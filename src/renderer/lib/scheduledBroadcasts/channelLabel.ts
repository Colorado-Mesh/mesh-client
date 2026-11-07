import type { TFunction } from 'i18next';

import type { DeviceRecord } from '@/renderer/stores/deviceStore';
import { getDevice } from '@/renderer/stores/deviceStore';
import type { ScheduledBroadcastTarget } from '@/shared/scheduledBroadcastTypes';

import { resolveChannelTargetIndex } from './resolveChannelTarget';

/** Localized kind prefix (`Meshtastic channel` / `MeshCore channel`). */
function channelKindLabel(kind: 'meshtastic-channel' | 'meshcore-channel', t: TFunction): string {
  return kind === 'meshtastic-channel'
    ? t('scheduledBroadcasts.targetKind.meshtasticChannel')
    : t('scheduledBroadcasts.targetKind.meshcoreChannel');
}

/** Live channel name for a slot on the given identity, or empty when unknown. */
export function lookupChannelName(
  kind: 'meshtastic-channel' | 'meshcore-channel',
  identityId: string,
  channelIndex: number,
  deviceOverride?: DeviceRecord,
): string {
  const device = deviceOverride ?? getDevice(identityId);
  if (kind === 'meshtastic-channel') {
    const fromChannels = device.channels.find((c) => c.index === channelIndex)?.name.trim();
    const fromConfigs = device.channelConfigs.find((c) => c.index === channelIndex)?.name.trim();
    return fromChannels || fromConfigs || '';
  }
  return device.meshcoreChannels?.find((c) => c.index === channelIndex)?.name.trim() || '';
}

/**
 * Display label for a channel target. Remaps via `channelKey` when the live radio map is
 * available; never used for routing.
 */
export function formatScheduledBroadcastChannelLabel(
  target: Pick<ScheduledBroadcastTarget, 'kind' | 'identityId' | 'channelIndex' | 'channelKey'>,
  t: TFunction,
  deviceOverride?: DeviceRecord,
): string {
  if (target.kind !== 'meshtastic-channel' && target.kind !== 'meshcore-channel') {
    return '';
  }
  const kindLabel = channelKindLabel(target.kind, t);
  const resolved = resolveChannelTargetIndex(target);
  if (!resolved.ok) {
    // Key missing / no live map — do not guess a name from a stale saved index.
    return `${kindLabel} ${target.channelIndex ?? 0}`;
  }
  const { channelIndex } = resolved;
  const name = lookupChannelName(target.kind, target.identityId, channelIndex, deviceOverride);
  if (name) {
    return t('scheduledBroadcasts.channelNamed', {
      kind: kindLabel,
      index: channelIndex,
      name,
    });
  }
  return `${kindLabel} ${channelIndex}`;
}

/** Refresh display label from live data for any target kind. */
export function formatScheduledBroadcastTargetLabel(
  target: ScheduledBroadcastTarget,
  t: TFunction,
  deviceOverride?: DeviceRecord,
): string {
  if (target.kind === 'meshtastic-channel' || target.kind === 'meshcore-channel') {
    return formatScheduledBroadcastChannelLabel(target, t, deviceOverride);
  }
  return target.label;
}
