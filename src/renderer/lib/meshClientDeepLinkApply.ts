/**
 * Apply classified mesh-client deep links (lxma / meshcore / lxm contact) to stores.
 * Used by MeshClientDeepLinkHost and in-app QrIngestControl handlers.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { pubkeyToNodeId } from '@/renderer/lib/meshcoreUtils';
import { registerReticulumKnownIdentity } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { refreshReticulumPeersFromSidecar } from '@/renderer/stores/reticulumPeerStore';
import { hexToBytesExact } from '@/shared/hexBytes';
import type { MeshClientDeepLink } from '@/shared/meshClientDeepLink';

export type DeepLinkApplyResult =
  | { ok: true; kind: MeshClientDeepLink['kind']; deferred?: boolean }
  | { ok: false; errorKey: string; detail?: string };

/** Import Columba lxma:// contact: register pubkey then SQLite saved contact. */
export async function applyLxmaContactImport(opts: {
  destinationHash: string;
  publicKeyHex: string;
  displayName?: string | null;
}): Promise<DeepLinkApplyResult> {
  const reg = await registerReticulumKnownIdentity(opts.destinationHash, opts.publicKeyHex);
  if (!reg.ok) {
    return {
      ok: false,
      errorKey: 'qrIngest.lxmaRegisterFailed',
      detail: reg.error,
    };
  }
  try {
    await window.electronAPI.db.upsertReticulumDestination({
      destination_hash: opts.destinationHash,
      display_name: opts.displayName ?? null,
      last_heard: Math.floor(Date.now() / 1000),
      is_contact: true,
    });
    void refreshReticulumPeersFromSidecar({ forceRefresh: true }).catch(() => {
      // catch-no-log-ok rate-limit rethrow from peer store — already debug-logged
    });
    return { ok: true, kind: 'lxmaContact' };
  } catch (err) {
    console.error('[applyLxmaContactImport] upsert failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'qrIngest.contactImportFailed' };
  }
}

/** Import mesh-client / legacy lxm://contact (History stamp; not necessarily saved contact). */
export async function applyLxmContactImport(opts: {
  destinationHash: string;
  name?: string | null;
  asSavedContact?: boolean;
}): Promise<DeepLinkApplyResult> {
  try {
    await window.electronAPI.db.upsertReticulumDestination({
      destination_hash: opts.destinationHash,
      display_name: opts.name ?? null,
      last_heard: Math.floor(Date.now() / 1000),
      ...(opts.asSavedContact ? { is_contact: true } : {}),
    });
    void refreshReticulumPeersFromSidecar({ forceRefresh: true }).catch(() => {
      // catch-no-log-ok rate-limit rethrow from peer store — already debug-logged
    });
    return { ok: true, kind: 'lxmContact' };
  } catch (err) {
    console.error('[applyLxmContactImport] upsert failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'qrIngest.contactImportFailed' };
  }
}

export interface MeshcoreContactApplyDeps {
  /** Persist to SQLite (+ optional radio). Returns false on failure. */
  saveContact: (opts: {
    nodeId: number;
    publicKeyHex: string;
    name: string;
    contactType: number;
  }) => Promise<boolean>;
}

/** Import official MeshCore contact/add URI into SQLite (and radio via dep). */
export async function applyMeshcoreContactAdd(
  opts: {
    name: string;
    publicKeyHex: string;
    type: number;
  },
  deps: MeshcoreContactApplyDeps,
): Promise<DeepLinkApplyResult> {
  try {
    const key = opts.publicKeyHex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      return { ok: false, errorKey: 'qrIngest.meshcoreContactImportFailed' };
    }
    const bytes = hexToBytesExact(key, 32);
    if (!bytes) {
      return { ok: false, errorKey: 'qrIngest.meshcoreContactImportFailed' };
    }
    const nodeId = pubkeyToNodeId(bytes);
    const ok = await deps.saveContact({
      nodeId,
      publicKeyHex: key,
      name: opts.name,
      contactType: opts.type,
    });
    if (!ok) return { ok: false, errorKey: 'qrIngest.meshcoreContactImportFailed' };
    return { ok: true, kind: 'meshcoreContactAdd' };
  } catch (err) {
    console.error('[applyMeshcoreContactAdd] failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'qrIngest.meshcoreContactImportFailed' };
  }
}

/** Channel prefill settle from MeshcoreChannelSection (or deferred when unmounted). */
export type MeshcoreChannelApplyOutcome = 'accepted' | 'deferred' | 'rejected';

export interface MeshcoreChannelApplyDeps {
  applyChannel: (opts: {
    name: string;
    secretHex: string;
    regionScope?: string;
  }) => Promise<MeshcoreChannelApplyOutcome>;
}

export async function applyMeshcoreChannelAdd(
  opts: { name: string; secretHex: string; regionScope?: string },
  deps: MeshcoreChannelApplyDeps,
): Promise<DeepLinkApplyResult> {
  try {
    const outcome = await deps.applyChannel(opts);
    if (outcome === 'rejected') {
      return { ok: false, errorKey: 'qrIngest.meshcoreChannelImportFailed' };
    }
    if (outcome === 'deferred') {
      return { ok: true, kind: 'meshcoreChannelAdd', deferred: true };
    }
    return { ok: true, kind: 'meshcoreChannelAdd' };
  } catch (err) {
    console.error('[applyMeshcoreChannelAdd] failed: ' + errLikeToLogString(err));
    return { ok: false, errorKey: 'qrIngest.meshcoreChannelImportFailed' };
  }
}
