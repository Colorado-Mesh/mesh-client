/**
 * Meshtastic module-port UI maps (Remote Hardware, Audio, PaxCounter, …) driven
 * by the `PacketRouter` `meshtastic_module_port` event.
 *
 * `MeshtasticProtocol.subscribe` attaches every typed module packet event and
 * tags it with a `portLabel`, replacing 14 duplicate `device.events.on*`
 * subscriptions in the runtime wire effects.
 *
 * Failure point: none — these maps are display-only session memory; an unknown
 * `portLabel` is ignored.
 */
import { fromBinary, type Message } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv1';
import { Mesh } from '@meshtastic/protobufs';
import type { Dispatch, SetStateAction } from 'react';

import { clearCayenneTelemetry, recordCayennePacket } from '../../stores/cayenneTelemetryStore';
import { recordKeyVerificationPacket } from '../../stores/keyVerificationStore';
import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { toPacketPayloadBytes } from '../packetPayload';
import type { MeshtasticModulePortEvent } from '../protocols/Protocol';
import { appendToRingMap } from '../sessionMemoryCaps';
import type { IdentityId } from '../types';
import { decodeCayenneLpp } from './cayenneLpp';
import { decodeMeshBeacon } from './meshBeaconCodec';
import { decodeKeyVerificationPacket } from './meshtasticKeyVerification';
import {
  appendModulePortEvent,
  appendPaxHistory,
  type HeardMeshBeacon,
  type ModulePortEvent,
  type NodeStatusEntry,
  type PaxCounterPoint,
} from './meshtasticModuleEvents';
import { decodeRemoteShellFrame } from './remoteShell';
import { abandonRemoteShellForIdentity, handleRemoteShellFrame } from './remoteShellSession';

interface RawModuleMessage {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

type RawMessageMapSetter = Dispatch<SetStateAction<Map<number, RawModuleMessage[]>>>;
const MAX_SINGLE_ENTRY_MAP_NODES = 128;

function setBoundedMapEntry<T>(previous: Map<number, T>, key: number, value: T): Map<number, T> {
  const updated = new Map(previous);
  updated.delete(key);
  updated.set(key, value);
  while (updated.size > MAX_SINGLE_ENTRY_MAP_NODES) {
    const oldestKey = updated.keys().next().value;
    if (oldestKey === undefined) break;
    updated.delete(oldestKey);
  }
  return updated;
}

export interface MeshtasticModulePortSideEffectsDeps {
  touchLastData: () => void;
  setRemoteHardwareMessages: RawMessageMapSetter;
  setAudioMessages: RawMessageMapSetter;
  setDetectionSensorEvents: Dispatch<SetStateAction<Map<number, ModulePortEvent[]>>>;
  setPingResponses: Dispatch<SetStateAction<Map<number, RawModuleMessage>>>;
  setIpTunnelMessages: RawMessageMapSetter;
  setPaxCounterData: Dispatch<SetStateAction<Map<number, PaxCounterPoint[]>>>;
  setSerialMessages: RawMessageMapSetter;
  setRangeTestPackets: Dispatch<SetStateAction<Map<number, ModulePortEvent[]>>>;
  setZpsMessages: RawMessageMapSetter;
  setSimulatorPackets: RawMessageMapSetter;
  setAtakMessages: RawMessageMapSetter;
  setMapReports: Dispatch<
    SetStateAction<Map<number, { from: number; data: unknown; timestamp: number }>>
  >;
  setPrivateMessages: RawMessageMapSetter;
  setMeshBeacons: Dispatch<SetStateAction<Map<number, HeardMeshBeacon>>>;
  setNodeStatuses: Dispatch<SetStateAction<Map<number, NodeStatusEntry>>>;
}

const StatusMessageSchema = (
  Mesh as unknown as {
    StatusMessageSchema: GenMessage<Message<'meshtastic.StatusMessage'> & { status?: unknown }>;
  }
).StatusMessageSchema;

/** Decode a `NODE_STATUS_APP` payload (`meshtastic.StatusMessage`); null on malformed bytes. */
export function decodeNodeStatus(bytes: Uint8Array): string | null {
  try {
    const msg: { status?: unknown } = fromBinary(StatusMessageSchema, bytes);
    return typeof msg.status === 'string' ? msg.status : '';
  } catch (err) {
    console.debug('[meshtasticModulePortSideEffects] malformed NODE_STATUS_APP payload', err);
    return null;
  }
}

/** Append to a per-node ring of raw module payloads (`keep` is the retained tail length). */
function appendRawMessage(
  setter: RawMessageMapSetter,
  entry: RawModuleMessage,
  keep: number,
): void {
  setter((prev) => appendToRingMap(prev, entry.from, entry, keep));
}

/**
 * Meshtastic `Paxcount` reports Wi-Fi and BLE device counts separately; the
 * panel plots a single total. JSON/MQTT mirrors may already carry `count`.
 */
function paxCount(data: unknown): number {
  const pax = data as { count?: unknown; wifi?: unknown; ble?: unknown } | null | undefined;
  if (typeof pax?.count === 'number' && Number.isFinite(pax.count)) {
    return Math.max(0, Math.trunc(pax.count));
  }
  const wifi = typeof pax?.wifi === 'number' && Number.isFinite(pax.wifi) ? pax.wifi : 0;
  const ble = typeof pax?.ble === 'number' && Number.isFinite(pax.ble) ? pax.ble : 0;
  return Math.max(0, Math.trunc(wifi) + Math.trunc(ble));
}

function handleModulePort(
  identityId: IdentityId,
  payload: MeshtasticModulePortEvent,
  deps: MeshtasticModulePortSideEffectsDeps,
): void {
  deps.touchLastData();
  const from = payload.from;
  const timestamp = payload.timestamp;
  const entry: RawModuleMessage = {
    from,
    data: toPacketPayloadBytes(payload.data),
    timestamp,
  };

  switch (payload.portLabel) {
    case 'remoteHardware':
      appendRawMessage(deps.setRemoteHardwareMessages, entry, 10);
      break;
    case 'audio':
      appendRawMessage(deps.setAudioMessages, entry, 50);
      break;
    case 'detectionSensor':
      deps.setDetectionSensorEvents((prev) => appendModulePortEvent(prev, entry));
      break;
    case 'ping':
      deps.setPingResponses((prev) => setBoundedMapEntry(prev, from, entry));
      break;
    case 'ipTunnel':
      appendRawMessage(deps.setIpTunnelMessages, entry, 100);
      break;
    case 'paxcounter':
      deps.setPaxCounterData((prev) =>
        appendPaxHistory(prev, { from, count: paxCount(payload.data), timestamp }),
      );
      break;
    case 'serial':
      appendRawMessage(deps.setSerialMessages, entry, 100);
      break;
    case 'rangeTest':
      deps.setRangeTestPackets((prev) => appendModulePortEvent(prev, entry));
      break;
    case 'zps':
      appendRawMessage(deps.setZpsMessages, entry, 50);
      break;
    case 'simulator':
      appendRawMessage(deps.setSimulatorPackets, entry, 50);
      break;
    // ATAK_PLUGIN_V2 (portnum 78) shares the TAK panel's buffer; the panel decodes
    // TAKPacketV2 from the bytes.
    case 'atakPlugin':
    case 'atakForwarder':
    case 'atakPluginV2':
      appendRawMessage(deps.setAtakMessages, entry, 100);
      break;
    case 'mapReport':
      deps.setMapReports((prev) =>
        setBoundedMapEntry(prev, from, { from, data: payload.data, timestamp }),
      );
      break;
    case 'private':
      appendRawMessage(deps.setPrivateMessages, entry, 50);
      break;
    case 'meshBeacon': {
      const beacon = decodeMeshBeacon(entry.data);
      if (beacon) {
        deps.setMeshBeacons((prev) =>
          setBoundedMapEntry(prev, from, { ...beacon, from, timestamp }),
        );
      }
      break;
    }
    case 'nodeStatus': {
      const status = decodeNodeStatus(entry.data);
      if (status != null) {
        deps.setNodeStatuses((prev) => {
          const next = new Map(prev);
          if (status.trim() === '') {
            next.delete(from);
            return next;
          }
          return setBoundedMapEntry(prev, from, { from, status, timestamp });
        });
      }
      break;
    }
    // KEY_VERIFICATION_APP: bind the handshake nonce to the sending node so the radio's
    // clientNotification (which only carries a long name) can be tied to a node.
    case 'keyVerification': {
      const packet = decodeKeyVerificationPacket(entry.data);
      if (packet) recordKeyVerificationPacket(identityId, { from, nonce: packet.nonce });
      break;
    }
    // CAYENNE_APP: Cayenne LPP sensor payloads → Telemetry panel charts (Meshtastic-only port).
    case 'cayenne': {
      const decoded = decodeCayenneLpp(entry.data);
      if (decoded.readings.length > 0)
        recordCayennePacket(identityId, { from, timestamp, decoded });
      break;
    }
    // REMOTE_SHELL_APP: PTY frames for the Admin-tab remote shell session (Meshtastic-only port).
    case 'remoteShell': {
      const frame = decodeRemoteShellFrame(entry.data);
      if (frame) handleRemoteShellFrame(identityId, from, frame);
      break;
    }
    // Portnums added in protobufs 2.8.0 with no dedicated panel yet. They are labeled
    // here and reach the Sniffer through the raw packet stream; listing them keeps the
    // switch an accurate record of what the app knows about.
    // ALERT_APP is decoded as text_message in MeshtasticProtocol (MECP / critical alerts).
    // PAGING_APP has no published PagingPacket schema yet.
    case 'storeForwardPlusPlus':
    case 'paging':
    case 'loraWanBridge':
    case 'reticulumTunnel':
    case 'loraOta':
    case 'groupAlarm':
      break;
    default:
      break;
  }
}

/** Attach module-port UI map updates for one Meshtastic identity. */
export function attachMeshtasticModulePortSideEffects(
  identityId: IdentityId,
  deps: MeshtasticModulePortSideEffectsDeps,
): () => void {
  const detach = attachTypedPacketListener(identityId, 'meshtastic_module_port', (payload) => {
    handleModulePort(identityId, payload, deps);
  });
  return () => {
    detach();
    // Radio gone: a remote shell can no longer send/receive, and Cayenne history is keyed by node
    // number only, so neither may leak into the next session.
    abandonRemoteShellForIdentity(identityId);
    clearCayenneTelemetry(identityId);
  };
}
