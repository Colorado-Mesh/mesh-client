import { useCallback } from 'react';

import type { IdentityId } from '../lib/types';
import { resolveCall } from './_protocolCall';

/** Meshtastic via Protocol; MeshCore still uses panel actions until companion config lands on Protocol. */
export function useCommitConfig(identityId: IdentityId | null) {
  return useCallback((): Promise<void> => {
    const ctx = resolveCall(identityId, 'useCommitConfig');
    if (!ctx) return Promise.resolve();
    if (ctx.identity.protocol.type === 'meshcore') {
      return Promise.reject(
        new Error(
          'MeshCore commitConfig: use panel actions (companion JSON paths; see ProtocolCompanion)',
        ),
      );
    }
    return ctx.identity.protocol.commitConfig(ctx.handle);
  }, [identityId]);
}
