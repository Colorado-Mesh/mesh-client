import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  type ProtocolCapabilities,
} from '../radio/BaseRadioProvider';
import type { MeshProtocol } from '../types';
import { meshcoreProtocol } from './MeshCoreProtocol';
import { meshtasticProtocol } from './MeshtasticProtocol';
import type { Protocol } from './Protocol';

export interface ProtocolRegistration {
  type: MeshProtocol;
  protocol: Protocol;
  capabilities: ProtocolCapabilities;
}

const REGISTRY: Record<MeshProtocol, ProtocolRegistration> = {
  meshtastic: {
    type: 'meshtastic',
    protocol: meshtasticProtocol,
    capabilities: MESHTASTIC_CAPABILITIES,
  },
  meshcore: {
    type: 'meshcore',
    protocol: meshcoreProtocol,
    capabilities: MESHCORE_CAPABILITIES,
  },
};

export function getProtocolRegistration(type: string): ProtocolRegistration | null {
  if (type === 'meshtastic' || type === 'meshcore') {
    return REGISTRY[type];
  }
  return null;
}

export function listRegisteredProtocols(): ProtocolRegistration[] {
  return Object.values(REGISTRY);
}

export function getProtocolForType(type: string): Protocol | null {
  return getProtocolRegistration(type)?.protocol ?? null;
}
