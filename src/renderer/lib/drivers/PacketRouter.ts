import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../../hooks/meshcore/meshcoreHookPreamble';
import type { ConnectionStatus } from '../../stores/connectionStore';
import { setConnection } from '../../stores/connectionStore';
import type { ChannelConfig } from '../../stores/deviceStore';
import {
  appendDeviceLog,
  appendRawPacket,
  getDevice,
  setDeviceChannels,
  setDeviceGpsState,
  setMeshcoreAutoaddConfig,
  setMeshcoreContacts,
  setMeshcoreSelfInfo,
  setMeshtasticConfigSlice,
  setModuleConfigs,
  setSecurityConfig,
  setTelemetryDeviceUpdateInterval,
  upsertMeshcoreChannel,
} from '../../stores/deviceStore';
import { getIdentity } from '../../stores/identityStore';
import { renameMessageId, upsertMessage, useMessageStore } from '../../stores/messageStore';
import {
  addTraceRoute,
  bumpMeshtasticNodesLastHeardAt,
  updatePosition,
  updateTelemetry,
  upsertNeighborInfo,
  upsertNode,
  upsertWaypoint,
  useNodeStore,
} from '../../stores/nodeStore';
import { getConnectedMeshcoreBleMac } from '../connectedMeshcoreBleMac';
import { errLikeToLogString } from '../errLikeToLogString';
import { shouldSuppressMeshtasticNodeHear } from '../meshcoreBleMacMeshtasticNodeId';
import { ensureMeshtasticChatSenderInNodeStore } from '../meshtastic/meshtasticChatSenderNode';
import { shouldSuppressMeshtasticLocalConfigWrite } from '../meshtastic/meshtasticConfigIngressGuard';
import { meshtasticTracerouteLastHeardNodeIds } from '../meshtasticLastHeard';
import type { DomainEvent, DomainEventType } from '../protocols/Protocol';
import { retargetMeshtasticOutboundTempId } from '../sessions/meshtasticSession';
import {
  MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
  MESHTASTIC_TAPBACK_OPTIMISTIC_DEDUP_WINDOW_MS,
} from '../timeConstants';
import type { IdentityId } from '../types';

function shouldSuppressMeshtasticGhostNodeHear(
  identityId: IdentityId,
  nodeId: number | undefined,
): boolean {
  if (nodeId == null || nodeId === 0) return false;
  if (getIdentity(identityId)?.protocol.type !== 'meshtastic') return false;
  return shouldSuppressMeshtasticNodeHear(nodeId, getConnectedMeshcoreBleMac());
}

function resolveMeshtasticSenderName(identityId: IdentityId, from: number): string | undefined {
  if (from <= 0) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  const node = useNodeStore.getState().nodes[identityId]?.[from];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Node may be absent when its identity bucket is missing.
  const shortName = node?.shortName?.trim();
  if (shortName) return shortName;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Node may be absent when its identity bucket is missing.
  const longName = node?.longName?.trim();
  if (longName) return longName.length > 7 ? longName.slice(0, 7) : longName;
  return formatMeshtasticNodeId(from);
}

function upsertByIndex<T extends { index: number }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.index === item.index);
  const next = i >= 0 ? arr.map((x, idx) => (idx === i ? item : x)) : [...arr, item];
  return next.sort((a, b) => a.index - b.index);
}

/**
 * Post-store hook invoked for every dispatched event.
 *
 * Ordering contract, relied on by ingest and the `attach*SideEffects` modules:
 * 1. `dispatch` applies the store mutation for the event type first, so a
 *    listener always observes `messageStore` / `nodeStore` / `deviceStore`
 *    already updated for the event it is handling.
 * 2. Listeners then run in registration order. A throwing listener is logged
 *    and skipped; later listeners and the store write still happen.
 * 3. When a Meshtastic local-config write is suppressed (`shouldSuppressMeshtasticLocalConfigWrite`),
 *    both the store mutation and listener notification are skipped — listeners must not observe a
 *    "store first" update that never happened.
 *
 * Prefer `attachTypedPacketListener` over registering raw listeners so the
 * identity filter and payload narrowing stay in one place.
 */
export type PacketRouterListener = (event: DomainEvent, identityId: IdentityId) => void;

interface PacketRouterListenerEntry {
  id: number;
  listener: PacketRouterListener;
}

const MAX_PACKET_ROUTER_LISTENERS = 256;

function roomPostWireBody(payload: string): string {
  return payload.length > 4 ? payload.slice(4) : payload;
}

function findRoomPostOptimistic(
  records: {
    id: string;
    status?: string;
    roomServerId?: number;
    channelIndex?: number;
    payload: string;
    timestamp: number;
  }[],
  event: Extract<DomainEvent, { type: 'text_message' }>['payload'],
): (typeof records)[number] | undefined {
  const roomServerId = event.roomServerId ?? event.from;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (roomServerId == null || roomServerId === 0) return undefined;
  const isRoomWire =
    event.roomServerId != null ||
    event.channelIndex === MESHCORE_ROOM_MESSAGE_CHANNEL ||
    event.id.startsWith('room:');
  if (!isRoomWire) return undefined;
  const body = roomPostWireBody(event.payload);
  return records.find(
    (m) =>
      m.status === 'sending' &&
      m.id !== event.id &&
      m.roomServerId === roomServerId &&
      m.channelIndex === MESHCORE_ROOM_MESSAGE_CHANNEL &&
      m.payload === body &&
      Math.abs(m.timestamp - event.timestamp) <= MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
  );
}

class PacketRouter {
  private readonly listeners: PacketRouterListenerEntry[] = [];
  private readonly typedListeners = new Map<DomainEventType, PacketRouterListenerEntry[]>();
  private nextListenerId = 1;

  /** Registers a listener at the end of the dispatch order. Returns a detach fn. */
  addListener(listener: PacketRouterListener): () => void {
    const entry = { id: this.nextListenerId++, listener };
    this.listeners.push(entry);
    this.enforceListenerLimit();
    return () => {
      this.removeListener(entry.id);
    };
  }

  addTypedListener(type: DomainEventType, listener: PacketRouterListener): () => void {
    return this.addTypedListeners([type], listener);
  }

  addTypedListeners(types: readonly DomainEventType[], listener: PacketRouterListener): () => void {
    const entry = { id: this.nextListenerId++, listener };
    for (const type of new Set(types)) {
      const entries = this.typedListeners.get(type) ?? [];
      entries.push(entry);
      this.typedListeners.set(type, entries);
    }
    this.enforceListenerLimit();
    return () => {
      this.removeListener(entry.id);
    };
  }

  private removeListener(id: number): void {
    const remaining = this.listeners.filter((entry) => entry.id !== id);
    this.listeners.length = 0;
    this.listeners.push(...remaining);
    for (const [type, entries] of this.typedListeners) {
      const next = entries.filter((entry) => entry.id !== id);
      if (next.length === 0) this.typedListeners.delete(type);
      else this.typedListeners.set(type, next);
    }
  }

  private enforceListenerLimit(): void {
    const ids = new Set<number>(this.listeners.map((entry) => entry.id));
    for (const entries of this.typedListeners.values()) {
      for (const entry of entries) ids.add(entry.id);
    }
    if (ids.size <= MAX_PACKET_ROUTER_LISTENERS) return;
    this.removeListener(Math.min(...ids));
    console.warn('[PacketRouter] evicted oldest listener after reaching session cap');
  }

  /** Live listener count. Exported for leak assertions in tests. */
  listenerCount(): number {
    const ids = new Set<number>(this.listeners.map((entry) => entry.id));
    for (const entries of this.typedListeners.values()) {
      for (const entry of entries) ids.add(entry.id);
    }
    return ids.size;
  }

  /** Applies the store mutation for `event`, then notifies listeners in order. */
  dispatch(event: DomainEvent, identityId: IdentityId): void {
    // When a suppress branch skips the store write, skip listeners too (contract §3).
    let skipListeners = false;
    switch (event.type) {
      case 'text_message': {
        const isMeshtastic = getIdentity(identityId)?.protocol.type === 'meshtastic';
        if (event.payload.id) {
          const byIdentity = useMessageStore.getState().messages[identityId] ?? {};
          const dedupWindowMs = event.payload.tapback
            ? MESHTASTIC_TAPBACK_OPTIMISTIC_DEDUP_WINDOW_MS
            : MESHCORE_ROOM_POST_DEDUP_WINDOW_MS;
          const optimistic = Object.values(byIdentity).find(
            (m) =>
              m.status === 'sending' &&
              m.id !== event.payload.id &&
              m.from === event.payload.from &&
              m.to === event.payload.to &&
              m.channelIndex === event.payload.channelIndex &&
              m.payload === event.payload.payload &&
              Math.abs(m.timestamp - event.payload.timestamp) <= dedupWindowMs,
          );
          const roomOptimistic =
            optimistic ?? findRoomPostOptimistic(Object.values(byIdentity), event.payload);
          if (roomOptimistic) {
            renameMessageId(identityId, roomOptimistic.id, event.payload.id);
            if (roomOptimistic.status === 'sending' && event.payload.tapback) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
              const renamed = useMessageStore.getState().messages[identityId]?.[event.payload.id];
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
              if (renamed) {
                upsertMessage(identityId, { ...renamed, status: 'acked' });
              }
            }
            if (isMeshtastic) {
              const tempNum = Number.parseInt(roomOptimistic.id, 10);
              if (Number.isFinite(tempNum) && tempNum > 0) {
                retargetMeshtasticOutboundTempId(tempNum, event.payload.id);
                if (event.payload.tapback) {
                  const realNum = Number.parseInt(event.payload.id, 10);
                  if (Number.isFinite(realNum) && realNum > 0 && realNum !== tempNum) {
                    void window.electronAPI.db
                      .updateMessagePacketId(tempNum, realNum, event.payload.from)
                      .catch((e: unknown) => {
                        console.warn(
                          '[PacketRouter] updateMessagePacketId failed ' + errLikeToLogString(e),
                        );
                      });
                  }
                }
              }
            }
          }
        }
        // Upsert (not add) so an outbound echo carrying the same packetId-derived
        // id merges into the optimistic row written by useSendMessage instead of
        // creating a duplicate.
        if (isMeshtastic) {
          ensureMeshtasticChatSenderInNodeStore(identityId, event.payload.from, {
            lastHeardAt: event.payload.timestamp,
            source: 'rf',
          });
        }
        const senderName = resolveMeshtasticSenderName(identityId, event.payload.from);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
        const existingRecord = useMessageStore.getState().messages[identityId]?.[event.payload.id];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Message may be absent when its identity bucket is missing.
        const existingReceivedVia = existingRecord?.receivedVia;
        const receivedVia =
          existingReceivedVia === 'mqtt' || existingReceivedVia === 'both'
            ? ('both' as const)
            : ('rf' as const);
        upsertMessage(identityId, {
          id: event.payload.id,
          from: event.payload.from,
          to: event.payload.to,
          payload: event.payload.payload,
          channelIndex: event.payload.channelIndex,
          timestamp: event.payload.timestamp,
          rxSnr: event.payload.rxSnr,
          rxRssi: event.payload.rxRssi,
          hopCount: event.payload.hopCount,
          tapback: event.payload.tapback,
          replyTo: event.payload.replyTo,
          receivedVia,
          ...(event.payload.roomServerId != null
            ? { roomServerId: event.payload.roomServerId }
            : {}),
          ...(senderName ? { senderName } : {}),
        });
        break;
      }
      case 'node_info':
        if (shouldSuppressMeshtasticGhostNodeHear(identityId, event.payload.nodeId)) {
          skipListeners = true;
          break;
        }
        upsertNode(identityId, event.payload);
        break;
      case 'position':
        if (shouldSuppressMeshtasticGhostNodeHear(identityId, event.payload.nodeId)) {
          skipListeners = true;
          break;
        }
        updatePosition(identityId, event.payload);
        break;
      case 'telemetry':
        if (shouldSuppressMeshtasticGhostNodeHear(identityId, event.payload.nodeId)) {
          skipListeners = true;
          break;
        }
        updateTelemetry(identityId, event.payload);
        break;
      case 'trace_route': {
        addTraceRoute(identityId, event.payload);
        if (getIdentity(identityId)?.protocol.type === 'meshtastic') {
          const bumpIds = meshtasticTracerouteLastHeardNodeIds(
            event.payload.from,
            event.payload.to,
          );
          bumpMeshtasticNodesLastHeardAt(identityId, bumpIds, event.payload.timestamp);
        }
        break;
      }
      case 'waypoint':
        upsertWaypoint(identityId, event.payload);
        break;
      case 'channel': {
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        const e = event.payload;
        const existing = getDevice(identityId);
        const name = e.name || (e.index === 0 ? 'Primary' : `Channel ${e.index}`);
        const channels =
          e.role !== 0
            ? upsertByIndex(existing.channels, { index: e.index, name })
            : existing.channels;
        const channelConfigEntry: ChannelConfig = {
          index: e.index,
          name: e.name,
          role: e.role,
          psk: e.psk,
          uplinkEnabled: e.uplinkEnabled,
          downlinkEnabled: e.downlinkEnabled,
          positionPrecision: e.positionPrecision,
        };
        const channelConfigs = upsertByIndex(existing.channelConfigs, channelConfigEntry);
        setDeviceChannels(identityId, channels, channelConfigs);
        break;
      }
      case 'device_gps_state':
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        setDeviceGpsState(identityId, event.payload.gpsMode, event.payload.fixedPosition);
        break;
      case 'security_config':
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        setSecurityConfig(identityId, event.payload);
        break;
      case 'module_config': {
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        const current = getDevice(identityId).moduleConfigs;
        setModuleConfigs(identityId, {
          ...current,
          [event.payload.configType]: event.payload.value,
        });
        break;
      }
      case 'telemetry_interval':
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        setTelemetryDeviceUpdateInterval(identityId, event.payload.interval);
        break;
      case 'meshtastic_config_slice':
        if (shouldSuppressMeshtasticLocalConfigWrite(identityId)) {
          skipListeners = true;
          break;
        }
        setMeshtasticConfigSlice(identityId, event.payload.configCase, event.payload.value);
        break;
      case 'queue_status': {
        setConnection(identityId, {
          queueFree: event.payload.free,
          queueMax: event.payload.maxlen,
        });
        break;
      }
      case 'device_log':
        appendDeviceLog(identityId, event.payload);
        break;
      case 'raw_packet':
        appendRawPacket(identityId, event.payload);
        break;
      case 'device_status':
        setConnection(identityId, { status: event.payload.status as ConnectionStatus });
        break;
      case 'device_metadata': {
        const { firmwareVersion, hasWifi, hasEthernet } = event.payload;
        const updates: Parameters<typeof setConnection>[1] = {};
        if (firmwareVersion) updates.firmwareVersion = firmwareVersion;
        if (hasWifi != null) updates.deviceHasWifi = hasWifi;
        if (hasEthernet != null) updates.deviceHasEthernet = hasEthernet;
        if (Object.keys(updates).length > 0) {
          setConnection(identityId, updates);
        }
        break;
      }
      case 'neighbor_info':
        upsertNeighborInfo(identityId, event.payload);
        break;
      case 'device_self_info':
        setMeshcoreSelfInfo(identityId, event.payload);
        break;
      case 'device_contacts':
        setMeshcoreContacts(identityId, event.payload.contacts);
        break;
      case 'device_autoadd':
        setMeshcoreAutoaddConfig(identityId, event.payload);
        break;
      case 'meshcore_channel':
        upsertMeshcoreChannel(identityId, event.payload);
        break;
    }
    if (skipListeners) return;
    const listeners = [...this.listeners, ...(this.typedListeners.get(event.type) ?? [])].sort(
      (a, b) => a.id - b.id,
    );
    // Snapshot before invoking: listeners may detach themselves during dispatch.
    for (const { listener } of listeners) {
      try {
        listener(event, identityId);
      } catch (e) {
        console.warn('[PacketRouter] listener error ' + errLikeToLogString(e));
      }
    }
  }
}

export const packetRouter = new PacketRouter();
