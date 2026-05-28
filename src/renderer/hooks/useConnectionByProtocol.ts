import { resolveIdentityIdForProtocol } from '../lib/identityByProtocol';
import type { MeshProtocol } from '../lib/types';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';

export function useConnectionByProtocol(protocol: MeshProtocol): ConnectionRecord | null {
  const identityId = useIdentityStore((s) =>
    resolveIdentityIdForProtocol(s.identities, s.activeIdentityId, protocol),
  );
  return useConnectionStore((s) => (identityId ? (s.connections[identityId] ?? null) : null));
}
