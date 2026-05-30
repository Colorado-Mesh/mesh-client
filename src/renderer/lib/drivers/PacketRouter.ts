import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

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
  updatePosition,
  updateTelemetry,
  upsertNeighborInfo,
  upsertNode,
  upsertWaypoint,
  useNodeStore,
} from '../../stores/nodeStore';
import { errLikeToLogString } from '../errLikeToLogString';
import { ensureMeshtasticChatSenderInNodeStore } from '../meshtastic/meshtasticChatSenderNode';
import type { DomainEvent } from '../protocols/Protocol';
import type { IdentityId } from '../types';

function resolveMeshtasticSenderName(identityId: IdentityId, from: number): string | undefined {
  if (from <= 0) return undefined;
  const node = useNodeStore.getState().nodes[identityId]?.[from];
  const shortName = node?.shortName?.trim();
  if (shortName) return shortName;
  const longName = node?.longName?.trim();
  if (longName) return longName.length > 7 ? longName.slice(0, 7) : longName;
  return formatMeshtasticNodeId(from);
}

function upsertByIndex<T extends { index: number }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.index === item.index);
  const next = i >= 0 ? arr.map((x, idx) => (idx === i ? item : x)) : [...arr, item];
  return next.sort((a, b) => a.index - b.index);
}

export type PacketRouterListener = (event: DomainEvent, identityId: IdentityId) => void;

class PacketRouter {
  private listeners: PacketRouterListener[] = [];

  addListener(listener: PacketRouterListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  dispatch(event: DomainEvent, identityId: IdentityId): void {
    switch (event.type) {
      case 'text_message': {
        if (event.payload.id) {
          const byIdentity = useMessageStore.getState().messages[identityId] ?? {};
          const optimistic = Object.values(byIdentity).find(
            (m) =>
              m.status === 'sending' &&
              m.id !== event.payload.id &&
              m.from === event.payload.from &&
              m.to === event.payload.to &&
              m.channelIndex === event.payload.channelIndex &&
              m.payload === event.payload.payload &&
              Math.abs(m.timestamp - event.payload.timestamp) <= 30_000,
          );
          if (optimistic) {
            renameMessageId(identityId, optimistic.id, event.payload.id);
          }
        }
        // Upsert (not add) so an outbound echo carrying the same packetId-derived
        // id merges into the optimistic row written by useSendMessage instead of
        // creating a duplicate.
        const isMeshtastic = getIdentity(identityId)?.protocol.type === 'meshtastic';
        if (isMeshtastic) {
          ensureMeshtasticChatSenderInNodeStore(identityId, event.payload.from, {
            lastHeardAt: event.payload.timestamp,
            source: 'rf',
          });
        }
        const senderName = resolveMeshtasticSenderName(identityId, event.payload.from);
        const existingRecord = useMessageStore.getState().messages[identityId]?.[event.payload.id];
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
          ...(existingRecord?.receivedVia === 'mqtt' ? {} : { receivedVia: 'rf' as const }),
          ...(event.payload.roomServerId != null
            ? { roomServerId: event.payload.roomServerId }
            : {}),
          ...(senderName ? { senderName } : {}),
        });
        break;
      }
      case 'node_info':
        upsertNode(identityId, event.payload);
        break;
      case 'position':
        updatePosition(identityId, event.payload);
        break;
      case 'telemetry':
        updateTelemetry(identityId, event.payload);
        break;
      case 'trace_route':
        addTraceRoute(identityId, event.payload);
        break;
      case 'waypoint':
        upsertWaypoint(identityId, event.payload);
        break;
      case 'channel': {
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
        setDeviceGpsState(identityId, event.payload.gpsMode, event.payload.fixedPosition);
        break;
      case 'security_config':
        setSecurityConfig(identityId, event.payload);
        break;
      case 'module_config': {
        const current = getDevice(identityId).moduleConfigs;
        setModuleConfigs(identityId, {
          ...current,
          [event.payload.configType]: event.payload.value,
        });
        break;
      }
      case 'telemetry_interval':
        setTelemetryDeviceUpdateInterval(identityId, event.payload.interval);
        break;
      case 'meshtastic_config_slice':
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
    for (const listener of this.listeners) {
      try {
        listener(event, identityId);
      } catch (e) {
        console.warn('[PacketRouter] listener error ' + errLikeToLogString(e));
      }
    }
  }
}

export const packetRouter = new PacketRouter();
