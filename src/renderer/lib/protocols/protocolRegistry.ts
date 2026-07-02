import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  type ProtocolCapabilities,
  RETICULUM_CAPABILITIES,
} from '../radio/BaseRadioProvider';
import type { MeshProtocol } from '../types';
import { isMeshProtocol } from '../types';
import { meshcoreProtocol } from './MeshCoreProtocol';
import { meshtasticProtocol } from './MeshtasticProtocol';
import type { Protocol } from './Protocol';
import { reticulumProtocol } from './ReticulumProtocol';

export interface ProtocolRegistration {
  type: MeshProtocol;
  protocol: Protocol;
  capabilities: ProtocolCapabilities;
}

const registrations = new Map<string, ProtocolRegistration>();

function registerProtocol(entry: ProtocolRegistration): void {
  registrations.set(entry.type, entry);
}

registerProtocol({
  type: 'meshtastic',
  protocol: meshtasticProtocol,
  capabilities: MESHTASTIC_CAPABILITIES,
});

registerProtocol({
  type: 'meshcore',
  protocol: meshcoreProtocol,
  capabilities: MESHCORE_CAPABILITIES,
});

registerProtocol({
  type: 'reticulum',
  protocol: reticulumProtocol,
  capabilities: RETICULUM_CAPABILITIES,
});

export function getProtocolRegistration(type: string): ProtocolRegistration | null {
  if (!isMeshProtocol(type)) return null;
  return registrations.get(type) ?? null;
}

export function listRegisteredProtocols(): ProtocolRegistration[] {
  return [...registrations.values()];
}

export function getProtocolForType(type: string): Protocol | null {
  return getProtocolRegistration(type)?.protocol ?? null;
}

/** Register an additional protocol at runtime (tests / future stacks). */
export function registerRuntimeProtocol(entry: ProtocolRegistration): void {
  if (!isMeshProtocol(entry.type)) {
    throw new Error(`registerRuntimeProtocol: unsupported type ${entry.type}`);
  }
  registerProtocol(entry);
}
