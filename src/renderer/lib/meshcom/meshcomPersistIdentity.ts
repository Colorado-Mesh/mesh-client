/**
 * MeshCom SQLite is keyed by identity_id. Session ids can be ephemeral (`id-*`) when
 * offline reuse fails; always persist/read under the stable offline slot so history
 * survives restart (see ConnectionDriver + offlineProtocolIdentities).
 */

import { OFFLINE_MESHCOM_IDENTITY_ID } from '../offlineProtocolIdentities';
import type { IdentityId } from '../types';

/**
 * Canonical SQLite identity for MeshCom messages and contacts.
 * Session identity is intentionally ignored — history must outlive rematch.
 */
export function meshcomPersistIdentityId(): IdentityId {
  return OFFLINE_MESHCOM_IDENTITY_ID;
}
