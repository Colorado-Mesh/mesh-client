import type { IdentityId } from '../lib/types';
import type { ConnectionRecord } from '../stores/connectionStore';
import { useConnectionStore } from '../stores/connectionStore';

export function useConnectionStatus(identityId: IdentityId): ConnectionRecord | null {
  return useConnectionStore((s) => s.connections[identityId] ?? null);
}

export function useAllConnections(): ConnectionRecord[] {
  return useConnectionStore((s) => Object.values(s.connections));
}
