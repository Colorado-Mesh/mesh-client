import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';

export function useConnectionByProtocol(protocolType: string): ConnectionRecord | null {
  const identityId = useIdentityStore(
    (s) => Object.values(s.identities).find((i) => i.protocol.type === protocolType)?.id ?? null,
  );
  return useConnectionStore((s) => (identityId ? (s.connections[identityId] ?? null) : null));
}
