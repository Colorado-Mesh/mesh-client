import { useCallback } from 'react';

import { MeshCoreProtocol } from '../lib/protocols/MeshCoreProtocol';
import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

/** Meshtastic-only until {@link MeshCoreProtocol.commitConfig} is implemented. */
export function useCommitConfig(identityId: IdentityId | null) {
  return useCallback((): Promise<void> => {
    const ctx = resolveCall(identityId, 'useCommitConfig');
    if (!ctx) return Promise.resolve();
    if (ctx.identity.protocol instanceof MeshCoreProtocol) {
      return Promise.reject(
        new Error(
          'MeshCore commitConfig: use meshcorePanelActions.commitConfig (legacy companion)',
        ),
      );
    }
    return ctx.identity.protocol.commitConfig(ctx.handle);
  }, [identityId]);
}
