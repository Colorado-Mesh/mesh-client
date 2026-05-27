import type { ConnectionStatus } from '../../stores/connectionStore';
import { setConnection } from '../../stores/connectionStore';
import type { ChannelConfig } from '../../stores/deviceStore';
import {
  appendDeviceLog,
  appendRawPacket,
  getDevice,
  setDeviceChannels,
  setDeviceGpsState,
  setModuleConfigs,
  setSecurityConfig,
  setTelemetryDeviceUpdateInterval,
} from '../../stores/deviceStore';
import { upsertMessage } from '../../stores/messageStore';
import {
  setMeshcoreAutoaddConfig,
  setMeshcoreContacts,
  setMeshcoreSelfInfo,
  upsertMeshcoreChannel,
} from '../../stores/deviceStore';
import {
  addTraceRoute,
  updatePosition,
  updateTelemetry,
  upsertNeighborInfo,
  upsertNode,
  upsertWaypoint,
} from '../../stores/nodeStore';
import type { DomainEvent } from '../protocols/Protocol';
import type { IdentityId } from '../types';

function upsertByIndex<T extends { index: number }>(arr: T[], item: T, _key: 'index'): T[] {
  const i = arr.findIndex((x) => x.index === item.index);
  const next = i >= 0 ? arr.map((x, idx) => (idx === i ? item : x)) : [...arr, item];
  return next.sort((a, b) => a.index - b.index);
}

class PacketRouter {
  dispatch(event: DomainEvent, identityId: IdentityId): void {
    switch (event.type) {
      case 'text_message':
        // Upsert (not add) so an outbound echo carrying the same packetId-derived
        // id merges into the optimistic row written by useSendMessage instead of
        // creating a duplicate.
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
        });
        break;
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
            ? upsertByIndex(existing.channels, { index: e.index, name }, 'index')
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
        const channelConfigs = upsertByIndex(existing.channelConfigs, channelConfigEntry, 'index');
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
      case 'queue_status':
        setConnection(identityId, {
          queueFree: event.payload.free,
          queueMax: event.payload.maxlen,
        });
        break;
      case 'device_log':
        appendDeviceLog(identityId, event.payload);
        break;
      case 'raw_packet':
        appendRawPacket(identityId, event.payload);
        break;
      case 'device_status':
        setConnection(identityId, { status: event.payload.status as ConnectionStatus });
        break;
      case 'device_metadata':
        // firmwareVersion is the only field; event may arrive before it is known
        if (event.payload.firmwareVersion) {
          setConnection(identityId, { firmwareVersion: event.payload.firmwareVersion });
        }
        break;
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
  }
}

export const packetRouter = new PacketRouter();
