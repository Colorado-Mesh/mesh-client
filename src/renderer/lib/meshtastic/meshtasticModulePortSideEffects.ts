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

import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import type { DomainEvent, MeshtasticModulePortEvent } from '../protocols/Protocol';
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

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  const raw = (data as { raw?: unknown } | null | undefined)?.raw;
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array();
}

/** Append to a per-node ring of raw module payloads (`keep` is the retained tail length). */
function appendRawMessage(
  setter: RawMessageMapSetter,
  entry: RawModuleMessage,
  keep: number,
): void {
  setter((prev) => {
    const updated = new Map(prev);
    const existing = updated.get(entry.from) ?? [];
    updated.set(entry.from, [...existing.slice(-keep), entry]);
    return updated;
  });
}

function handleModulePort(
  payload: MeshtasticModulePortEvent,
  deps: MeshtasticModulePortSideEffectsDeps,
): void {
  deps.touchLastData();
  const from = payload.from;
  const timestamp = payload.timestamp;
  const entry: RawModuleMessage = { from, data: toBytes(payload.data), timestamp };

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
      deps.setPingResponses((prev) => {
        const updated = new Map(prev);
        updated.set(from, entry);
        return updated;
      });
      break;
    case 'ipTunnel':
      appendRawMessage(deps.setIpTunnelMessages, entry, 100);
      break;
    case 'paxcounter': {
      const pax = payload.data as { count?: number } | undefined;
      deps.setPaxCounterData((prev) =>
        appendPaxHistory(prev, { from, count: pax?.count ?? 0, timestamp }),
      );
      break;
    }
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
      deps.setMapReports((prev) => {
        const updated = new Map(prev);
        updated.set(from, { from, data: payload.data, timestamp });
        return updated;
      });
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
  const listener: PacketRouterListener = (event: DomainEvent, routedIdentityId) => {
    if (routedIdentityId !== identityId || event.type !== 'meshtastic_module_port') return;
    handleModulePort(event.payload, deps);
  };
  return packetRouter.addListener(listener);
}
