import type { MeshProtocol } from '../lib/types';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';

export function useConnectionByProtocol(protocol: MeshProtocol): ConnectionRecord | null {
  const identityId = useIdentityStore((s) => {
    if (s.activeIdentityId) {
      const active = s.identities[s.activeIdentityId];
      if (active?.protocol.type === protocol) return s.activeIdentityId;
    }
    const matches = Object.values(s.identities)
      .filter((i) => i.protocol.type === protocol)
      .sort((a, b) => a.createdAt - b.createdAt);
    return matches[0]?.id ?? null;
  });
  return useConnectionStore((s) => (identityId ? (s.connections[identityId] ?? null) : null));
}
