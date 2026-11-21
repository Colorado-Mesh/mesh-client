/**
 * Lazy MeshCom protocol registration — keeps codecs/transport out of the App entry chunk.
 */

import { MESHCOM_CAPABILITIES } from '../radio/BaseRadioProvider';
import type { Protocol } from './Protocol';
import { getProtocolForType, registerRuntimeProtocol } from './protocolRegistry';

let loadPromise: Promise<Protocol> | null = null;

/** Ensure MeshCom is registered; safe to call on every MeshCom connect/send. */
export async function ensureMeshcomProtocolLoaded(): Promise<Protocol> {
  const existing = getProtocolForType('meshcom');
  if (existing) return existing;
  loadPromise ??= import('./MeshComProtocol')
    .then((mod) => {
      registerRuntimeProtocol({
        type: 'meshcom',
        protocol: mod.meshcomProtocol,
        capabilities: MESHCOM_CAPABILITIES,
      });
      return mod.meshcomProtocol;
    })
    .catch((err: unknown) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}
