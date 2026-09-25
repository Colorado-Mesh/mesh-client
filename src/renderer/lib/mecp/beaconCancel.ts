/**
 * Transmit MECP B03 when the local operator resolves a distress beacon they originated.
 *
 * B03 means "I am OK". Receivers clear only beacons whose sender id matches the B03 sender
 * (`incidentStore` upsert). A third party's cancel would not stop the victim's beacon, so
 * Resolve stays local unless this station originated it.
 */

import { useIncidentStore } from '@/renderer/stores/incidentStore';
import { isMeshProtocol, type MeshProtocol } from '@/shared/meshProtocol';

import { requestChatOutboxDrain } from '../chatOutboxDrain';
import { type EmergencySendDeps, sendEmergencyText } from '../emergencySend';
import { errLikeToLogString } from '../errLikeToLogString';
import type { EmergencyIncident } from './incidentTypes';
import { composeBeaconCancel } from './mecpAck';

const inFlight = new Set<string>();

export function resetBeaconCancelInFlightForTests(): void {
  inFlight.clear();
}

/** Decimal node ids this station may have used as `MessageRecord.from` / incident `senderId`. */
export function ownSenderIdSet(ids: Iterable<number | null | undefined>): ReadonlySet<string> {
  const set = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) continue;
    set.add(String(id));
  }
  return set;
}

export function incidentOriginatedLocally(
  incident: Pick<EmergencyIncident, 'senderId' | 'localOrigin'>,
  ownSenderIds: ReadonlySet<string>,
): boolean {
  return incident.localOrigin === true || ownSenderIds.has(incident.senderId);
}

/** Active beacon this station originated — the only case that should air a B03. */
export function shouldTransmitBeaconCancel(
  incident: Pick<EmergencyIncident, 'status' | 'beaconActive' | 'senderId' | 'localOrigin'>,
  ownSenderIds: ReadonlySet<string>,
): boolean {
  return (
    incident.status !== 'resolved' &&
    incident.beaconActive &&
    incidentOriginatedLocally(incident, ownSenderIds)
  );
}

/**
 * Unicast destination to repeat on B03. Channel floods and the Meshtastic/MeshCore broadcast
 * address stay null so the cancel is heard by everyone who heard the beacon.
 */
export function beaconCancelToNodeForMessage(protocol: MeshProtocol, to: number): number | null {
  if (!Number.isFinite(to)) return null;
  const toU = to >>> 0;
  if (protocol === 'reticulum') return toU > 0 ? toU : null;
  if (toU === 0 || toU === 0xffffffff) return null;
  return toU;
}

export interface BeaconCancelRoute {
  protocol: MeshProtocol;
  channel: number;
  toNode: number | null;
  viewKey: string;
}

function parseIncidentChannel(channel: string | null): number {
  if (channel == null) return 0;
  const n = Number(channel);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Origin protocol + channel (or the original unicast `to`). Returns null when a DM-only
 * protocol has no stored destination — queueing that row would retry forever without a peer.
 */
export function resolveBeaconCancelRoute(
  incident: Pick<
    EmergencyIncident,
    'protocol' | 'protocolsSeen' | 'channel' | 'beaconCancelToNode'
  >,
  isDmOnly: (protocol: MeshProtocol) => boolean,
): BeaconCancelRoute | null {
  const protocol = incident.protocolsSeen[0] ?? incident.protocol;
  const channel = parseIncidentChannel(incident.channel);
  const toNode = incident.beaconCancelToNode ?? null;
  if (isDmOnly(protocol) && toNode == null) return null;
  const viewKey = toNode != null ? `dm:${toNode}` : `ch:${channel}`;
  return { protocol, channel, toNode, viewKey };
}

export interface BeaconCancelDeps {
  isSendAvailable: (protocol: MeshProtocol) => boolean;
  sendFn: (protocol: MeshProtocol) => EmergencySendDeps['sendFn'];
  queueOutbox: EmergencySendDeps['queueOutbox'];
}

export type BeaconCancelResult =
  'resolved' | 'cancel-sent' | 'cancel-queued' | 'cancel-pending' | 'cancel-failed';

/**
 * Resolve locally, and when this station originated an active beacon, send one B03 on the
 * emergency outbox first. The row stays open if the cancel cannot be sent or queued.
 * A second call while the first send is in flight does not queue another B03.
 */
export async function resolveIncidentWithBeaconCancel(
  incident: EmergencyIncident,
  ownSenderIds: ReadonlySet<string>,
  deps: BeaconCancelDeps,
  isDmOnly: (protocol: MeshProtocol) => boolean,
): Promise<BeaconCancelResult> {
  const store = useIncidentStore.getState();
  const current = store.incidents[incident.id] ?? incident;
  if (!shouldTransmitBeaconCancel(current, ownSenderIds)) {
    store.resolveIncident(incident.id);
    return 'resolved';
  }
  if (inFlight.has(incident.id)) return 'cancel-pending';

  const route = resolveBeaconCancelRoute(current, isDmOnly);
  if (route == null) {
    console.warn('[beaconCancel] no destination for originated beacon cancel', incident.id);
    return 'cancel-failed';
  }

  inFlight.add(incident.id);
  try {
    const text = composeBeaconCancel(current.severity);
    const outcome = await sendEmergencyText(text, {
      isSendAvailable: deps.isSendAvailable(route.protocol),
      sendFn: deps.sendFn(route.protocol),
      queueOutbox: async (entry) => {
        const row = await deps.queueOutbox(entry);
        if (isMeshProtocol(entry.protocol)) requestChatOutboxDrain(entry.protocol);
        return row;
      },
      protocol: route.protocol,
      viewKey: route.viewKey,
      channel: route.channel,
      toNode: route.toNode,
    });
    useIncidentStore.getState().resolveIncident(incident.id);
    return outcome === 'sent' ? 'cancel-sent' : 'cancel-queued';
  } catch (err: unknown) {
    console.warn('[beaconCancel] send failed ' + errLikeToLogString(err));
    return 'cancel-failed';
  } finally {
    inFlight.delete(incident.id);
  }
}
