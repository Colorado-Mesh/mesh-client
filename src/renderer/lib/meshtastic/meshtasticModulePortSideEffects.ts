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
import type { Dispatch, SetStateAction } from 'react';

import { attachTypedPacketListener } from '../drivers/attachTypedPacketListener';
import { toPacketPayloadBytes } from '../packetPayload';
import type { MeshtasticModulePortEvent } from '../protocols/Protocol';
import { appendToRingMap } from '../sessionMemoryCaps';
import type { IdentityId } from '../types';
import {
  appendModulePortEvent,
  appendPaxHistory,
  type ModulePortEvent,
  type PaxCounterPoint,
} from './meshtasticModuleEvents';

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
    case 'atakPlugin':
    case 'atakForwarder':
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
    default:
      break;
  }
}

/** Attach module-port UI map updates for one Meshtastic identity. */
export function attachMeshtasticModulePortSideEffects(
  identityId: IdentityId,
  deps: MeshtasticModulePortSideEffectsDeps,
): () => void {
  return attachTypedPacketListener(identityId, 'meshtastic_module_port', (payload) => {
    handleModulePort(payload, deps);
  });
}
