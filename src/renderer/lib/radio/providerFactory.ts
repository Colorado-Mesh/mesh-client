import { useMemo } from 'react';

import type { MeshProtocol } from '../types';
import type { ProtocolCapabilities } from './BaseRadioProvider';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from './BaseRadioProvider';

export type { ProtocolCapabilities };

/**
 * Returns the ProtocolCapabilities for the active protocol.
 * Memoized on protocol identity — stable across renders unless protocol changes.
 */
export function useRadioProvider(protocol: MeshProtocol): ProtocolCapabilities {
  return useMemo(
    () => (protocol === 'meshcore' ? MESHCORE_CAPABILITIES : MESHTASTIC_CAPABILITIES),
    [protocol],
  );
}
