import {
  addIdentity,
  getIdentity,
  type IdentityRecord,
  useIdentityStore,
} from '../stores/identityStore';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';
import type { Protocol } from './protocols/Protocol';
import { type IdentityId, type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from './types';

/** Stable identity bucket for SQLite hydration before the first RF connect. */
export const OFFLINE_MESHTASTIC_IDENTITY_ID = 'offline-meshtastic' as IdentityId;
export const OFFLINE_MESHCORE_IDENTITY_ID = 'offline-meshcore' as IdentityId;

export const OFFLINE_IDENTITY_BY_PROTOCOL: Record<MeshProtocol, IdentityId> = {
  meshtastic: OFFLINE_MESHTASTIC_IDENTITY_ID,
  meshcore: OFFLINE_MESHCORE_IDENTITY_ID,
};

const OFFLINE_PROTOCOL_ADAPTERS: Record<MeshProtocol, Protocol> = {
  meshtastic: meshtasticProtocol,
  meshcore: meshcoreProtocol,
};

const OFFLINE_CREATED_AT = 0;

export function getOfflineIdentityIdForProtocol(protocol: MeshProtocol): IdentityId {
  return OFFLINE_IDENTITY_BY_PROTOCOL[protocol];
}

/** True when the identity has never had a live transport (still the pre-connect slot). */
export function isReusableOfflineIdentity(record: IdentityRecord): boolean {
  return record.transports.length === 0;
}

/**
 * Ensures one offline identity per protocol so startup DB hydration can populate Zustand
 * before connect ([#375]).
 */
export function ensureOfflineProtocolIdentities(): void {
  const { identities } = useIdentityStore.getState();
  for (const protocol of REGISTERED_MESH_PROTOCOLS) {
    const id = OFFLINE_IDENTITY_BY_PROTOCOL[protocol];
    if (identities[id]) continue;
    addIdentity({
      id,
      protocol: OFFLINE_PROTOCOL_ADAPTERS[protocol],
      signature: '',
      transports: [],
      createdAt: OFFLINE_CREATED_AT,
      lastSeenAt: OFFLINE_CREATED_AT,
    });
  }
}

/** Reuse the offline slot on first connect so hydrated chat/nodes stay in one store slice. */
export function tryReuseOfflineProtocolIdentity(protocol: MeshProtocol): IdentityId | null {
  const id = getOfflineIdentityIdForProtocol(protocol);
  const rec = getIdentity(id);
  if (rec?.protocol.type === protocol && isReusableOfflineIdentity(rec)) {
    return id;
  }
  return null;
}
