import type { IdentityId } from '../lib/types';
import type { IdentityRecord } from '../stores/identityStore';
import { useIdentityStore } from '../stores/identityStore';

export function useIdentity(identityId: IdentityId): IdentityRecord | null {
  return useIdentityStore((s) => s.identities[identityId] ?? null);
}

export function useActiveIdentity(): IdentityRecord | null {
  return useIdentityStore((s) =>
    s.activeIdentityId ? (s.identities[s.activeIdentityId] ?? null) : null,
  );
}

export function useIdentities(): IdentityRecord[] {
  return useIdentityStore((s) => Object.values(s.identities));
}
