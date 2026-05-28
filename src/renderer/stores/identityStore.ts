import { create } from 'zustand';

import type { Protocol } from '../lib/protocols/Protocol';
import type { IdentityId, TransportRef } from '../lib/types';
import { omitRecordKey } from './storeUtils';

export interface IdentityRecord {
  id: IdentityId;
  /** Reference to the shared singleton Protocol implementation for this identity. */
  protocol: Protocol;
  /**
   * Device-intrinsic signature used to recognise this identity across reconnects.
   * MeshCore: device pubkey hex. Meshtastic: stringified `myNodeNum`. Empty for
   * a provisional identity that hasn't completed discovery yet.
   */
  signature: string;
  /** Currently-live transports for this identity. Open list — no primary/secondary distinction. */
  transports: TransportRef[];
  displayName?: string;
  shortName?: string;
  hardwareModel?: string;
  selfNodeNum?: number;
  publicKey?: Uint8Array;
  createdAt: number;
  lastSeenAt: number;
}

interface IdentityStoreState {
  identities: Record<IdentityId, IdentityRecord>;
  activeIdentityId: IdentityId | null;
}

const defaultState: IdentityStoreState = {
  identities: {},
  activeIdentityId: null,
};

export const useIdentityStore = create<IdentityStoreState>()(() => defaultState);

export function addIdentity(identity: IdentityRecord): void {
  useIdentityStore.setState((s) => ({
    identities: { ...s.identities, [identity.id]: identity },
  }));
}

export function removeIdentity(id: IdentityId): void {
  useIdentityStore.setState((s) => ({
    identities: omitRecordKey(s.identities, id),
    activeIdentityId: s.activeIdentityId === id ? null : s.activeIdentityId,
  }));
}

export function setActiveIdentity(id: IdentityId | null): void {
  useIdentityStore.setState({ activeIdentityId: id });
}

export function updateIdentity(
  id: IdentityId,
  updates: Partial<Omit<IdentityRecord, 'id' | 'protocol'>>,
): void {
  useIdentityStore.setState((s) => {
    const existing = s.identities[id];
    if (!existing) return s;
    return { identities: { ...s.identities, [id]: { ...existing, ...updates } } };
  });
}

export function getIdentity(id: IdentityId): IdentityRecord | null {
  return useIdentityStore.getState().identities[id] ?? null;
}

export function findIdentityBySignature(signature: string): IdentityRecord | null {
  if (!signature) return null;
  return (
    Object.values(useIdentityStore.getState().identities).find((i) => i.signature === signature) ??
    null
  );
}

export function addTransport(id: IdentityId, transport: TransportRef): void {
  useIdentityStore.setState((s) => {
    const existing = s.identities[id];
    if (!existing) return s;
    return {
      identities: {
        ...s.identities,
        [id]: { ...existing, transports: [...existing.transports, transport] },
      },
    };
  });
}

export function updateTransport(
  id: IdentityId,
  transportId: string,
  updates: Partial<TransportRef>,
): void {
  useIdentityStore.setState((s) => {
    const existing = s.identities[id];
    if (!existing) return s;
    const next = existing.transports.map((t) =>
      t.transportId === transportId ? { ...t, ...updates } : t,
    );
    return { identities: { ...s.identities, [id]: { ...existing, transports: next } } };
  });
}

export function removeTransport(id: IdentityId, transportId: string): void {
  useIdentityStore.setState((s) => {
    const existing = s.identities[id];
    if (!existing) return s;
    return {
      identities: {
        ...s.identities,
        [id]: {
          ...existing,
          transports: existing.transports.filter((t) => t.transportId !== transportId),
        },
      },
    };
  });
}
