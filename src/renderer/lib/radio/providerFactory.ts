import { useMemo } from 'react';

import { getProtocolRegistration } from '../protocols/protocolRegistry';
import type { MeshProtocol } from '../types';
import type { ProtocolCapabilities } from './BaseRadioProvider';
import { MESHTASTIC_CAPABILITIES } from './BaseRadioProvider';

export type { ProtocolCapabilities };

function resolveCapabilities(protocol: MeshProtocol): ProtocolCapabilities {
  const registration = getProtocolRegistration(protocol);
  if (registration) return registration.capabilities;
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[useRadioProvider] Unknown protocol "${protocol}", falling back to Meshtastic capabilities`,
    );
  }
  return MESHTASTIC_CAPABILITIES;
}

/**
 * Returns the ProtocolCapabilities for the active protocol.
 * Memoized on protocol identity — stable across renders unless protocol changes.
 */
export function useRadioProvider(protocol: MeshProtocol): ProtocolCapabilities {
  return useMemo(() => resolveCapabilities(protocol), [protocol]);
}
