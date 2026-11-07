import type { TFunction } from 'i18next';

import type { IdentityId } from '@/renderer/lib/types';
import { getConnection } from '@/renderer/stores/connectionStore';
import { getIdentity, type IdentityRecord } from '@/renderer/stores/identityStore';
import { useNodeStore } from '@/renderer/stores/nodeStore';

/** Same connectivity gate as scheduled-broadcast delivery (`deliver.ts`). */
export function isScheduledBroadcastIdentityConnected(identityId: IdentityId): boolean {
  const conn = getConnection(identityId);
  if (!conn) return false;
  if (conn.status === 'connected' || conn.status === 'configured') return true;
  return getIdentity(identityId)?.protocol.type === 'meshtastic' && conn.mqttStatus === 'connected';
}

function protocolNameKey(protocol: string): string {
  if (protocol === 'meshtastic') return 'weather.protocol.meshtastic';
  if (protocol === 'meshcore') return 'weather.protocol.meshcore';
  return 'weather.protocol.reticulum';
}

/**
 * Human radio name for a scheduled-broadcast identity legend.
 * Never returns a truncated `offline-*` hydration-slot id.
 */
export function resolveScheduledBroadcastRadioName(identity: IdentityRecord, t: TFunction): string {
  const selfNum = identity.selfNodeNum ?? getConnection(identity.id)?.myNodeNum;
  // Runtime bucket may be missing before hydration; Record indexing types it as present.
  const selfNode =
    selfNum && selfNum > 0
      ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- nodes[id] absent until hydrate
        useNodeStore.getState().nodes[identity.id]?.[selfNum]
      : undefined;
  const fromNode = selfNode?.longName?.trim();
  if (fromNode) return fromNode;
  const fromIdentity = identity.displayName?.trim();
  if (fromIdentity) return fromIdentity;
  return t(protocolNameKey(identity.protocol.type));
}

/** Fieldset legend: radio/protocol name plus connected vs disconnected. */
export function formatScheduledBroadcastIdentityLegend(
  identity: IdentityRecord,
  t: TFunction,
): string {
  const name = resolveScheduledBroadcastRadioName(identity, t);
  const connected = isScheduledBroadcastIdentityConnected(identity.id);
  return connected
    ? t('scheduledBroadcasts.identityConnected', { name })
    : t('scheduledBroadcasts.identityDisconnected', { name });
}
