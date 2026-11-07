import type { ChannelIdentityProtocol } from '@/shared/channelIdentityKey';
import type { ScheduledBroadcastTarget } from '@/shared/scheduledBroadcastTypes';

import { getLiveChannelKeys } from '../../stores/liveChannelKeyStore';

export type ResolveChannelTargetResult =
  { ok: true; channelIndex: number } | { ok: false; reason: 'channel-missing' | 'send-failed' };

function protocolForTarget(kind: ScheduledBroadcastTarget['kind']): ChannelIdentityProtocol | null {
  if (kind === 'meshtastic-channel') return 'meshtastic';
  if (kind === 'meshcore-channel') return 'meshcore';
  return null;
}

/**
 * Map a stored channel target to the connected radio's current slot.
 * Prefer `channelKey` (survives reorder); fall back to `channelIndex` for legacy rows.
 */
export function resolveChannelTargetIndex(
  target: Pick<ScheduledBroadcastTarget, 'kind' | 'channelIndex' | 'channelKey'>,
  liveKeyByIndex?: Readonly<Record<number, string>> | null,
): ResolveChannelTargetResult {
  const protocol = protocolForTarget(target.kind);
  if (!protocol) return { ok: false, reason: 'send-failed' };

  const keyByIndex = liveKeyByIndex ?? getLiveChannelKeys(protocol)?.keyByIndex ?? null;

  if (target.channelKey) {
    const want = target.channelKey.toLowerCase();
    if (keyByIndex) {
      for (const [indexStr, key] of Object.entries(keyByIndex)) {
        if (key.toLowerCase() === want) {
          const channelIndex = Number(indexStr);
          if (Number.isInteger(channelIndex) && channelIndex >= 0) {
            return { ok: true, channelIndex };
          }
        }
      }
      // Key known at save time but not on this radio's current map.
      return { ok: false, reason: 'channel-missing' };
    }
    // No live map yet (disconnected) — cannot safely send by key alone.
    return { ok: false, reason: 'channel-missing' };
  }

  if (
    target.channelIndex == null ||
    !Number.isInteger(target.channelIndex) ||
    target.channelIndex < 0
  ) {
    return { ok: false, reason: 'send-failed' };
  }

  // Legacy index-only: if live map exists and the slot is gone, treat as missing.
  if (keyByIndex && !(target.channelIndex in keyByIndex)) {
    return { ok: false, reason: 'channel-missing' };
  }
  return { ok: true, channelIndex: target.channelIndex };
}
