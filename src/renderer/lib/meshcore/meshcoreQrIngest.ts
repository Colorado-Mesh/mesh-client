/**
 * MeshCore QR classify + contact import (DB + identity node store).
 * Share QR already lives on NodeDetailModal; scan entry points use this module.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { syncNodesMapToIdentityStore } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import { meshcoreContactToMeshNode, pubkeyToNodeId } from '@/renderer/lib/meshcoreUtils';
import type { MeshNode } from '@/renderer/lib/types';
import { hexToBytesExact } from '@/shared/hexBytes';
import { classifyMeshClientDeepLink } from '@/shared/meshClientDeepLink';

export type MeshcoreQrDecoded =
  | { kind: 'meshcoreContactAdd'; name: string; publicKeyHex: string; type: number }
  | {
      kind: 'meshcoreChannelAdd';
      name: string;
      secretHex: string;
      regionScope?: string;
    }
  | { kind: 'meshtasticChannel'; url: string }
  | { kind: 'unsupported' };

export interface MeshcoreQrImportResult {
  ok: boolean;
  kind: 'contact' | 'channel' | 'unsupported';
  /** i18n key for the toast. */
  toastKey: string;
  nodeId?: number;
  node?: MeshNode;
  publicKey?: Uint8Array;
  channel?: { name: string; secretHex: string; regionScope?: string };
}

/** Narrow `classifyMeshClientDeepLink` to kinds MeshCore surfaces can apply. */
export function classifyMeshcoreQr(raw: string): MeshcoreQrDecoded {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'unsupported' };
  const parsed = classifyMeshClientDeepLink(trimmed);
  if (parsed.kind === 'meshcoreContactAdd') {
    return {
      kind: 'meshcoreContactAdd',
      name: parsed.name,
      publicKeyHex: parsed.publicKeyHex,
      type: parsed.type,
    };
  }
  if (parsed.kind === 'meshcoreChannelAdd') {
    return {
      kind: 'meshcoreChannelAdd',
      name: parsed.name,
      secretHex: parsed.secretHex,
      ...(parsed.regionScope !== undefined ? { regionScope: parsed.regionScope } : {}),
    };
  }
  if (parsed.kind === 'meshtasticChannel') {
    return { kind: 'meshtasticChannel', url: parsed.url };
  }
  return { kind: 'unsupported' };
}

export interface MeshcoreQrContactImportDeps {
  /** Identity bucket to update (live or offline MeshCore slot). */
  identityId: string | null;
  /** Optional: mark mount hydration skip so DB reload does not clobber the optimistic row. */
  skipMountDbHydrationCommit?: () => void;
  /** Persist contact; returns false on failure. Defaults to SQLite `on_radio: 0`. */
  saveContact?: (opts: {
    nodeId: number;
    publicKeyHex: string;
    name: string;
    contactType: number;
  }) => Promise<boolean>;
}

async function defaultSaveMeshcoreContact(opts: {
  nodeId: number;
  publicKeyHex: string;
  name: string;
  contactType: number;
}): Promise<boolean> {
  try {
    await window.electronAPI.db.saveMeshcoreContact({
      node_id: opts.nodeId,
      public_key: opts.publicKeyHex.toLowerCase(),
      adv_name: opts.name,
      contact_type: opts.contactType,
      on_radio: 0,
    });
    return true;
  } catch (err) {
    console.error('[meshcoreQrIngest] saveMeshcoreContact failed: ' + errLikeToLogString(err));
    return false;
  }
}

/**
 * Classify decoded QR text and apply MeshCore contact imports immediately
 * (identity store + SQLite). Channel / unsupported kinds are returned for the caller to route.
 * Works offline — contact import is DB-only (`on_radio: 0`).
 */
export async function importMeshcoreQr(
  text: string,
  deps: MeshcoreQrContactImportDeps,
): Promise<MeshcoreQrImportResult> {
  const decoded = classifyMeshcoreQr(text);
  if (decoded.kind === 'meshcoreChannelAdd') {
    return {
      ok: true,
      kind: 'channel',
      toastKey: 'qrIngest.meshcoreChannelImported',
      channel: {
        name: decoded.name,
        secretHex: decoded.secretHex,
        ...(decoded.regionScope !== undefined ? { regionScope: decoded.regionScope } : {}),
      },
    };
  }
  if (decoded.kind !== 'meshcoreContactAdd') {
    return { ok: false, kind: 'unsupported', toastKey: 'qrIngest.unknownLink' };
  }

  try {
    const bytes = hexToBytesExact(decoded.publicKeyHex, 32);
    if (!bytes) {
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }
    const nodeId = pubkeyToNodeId(bytes);
    if (nodeId === 0) {
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }

    const node = meshcoreContactToMeshNode({
      publicKey: bytes,
      type: decoded.type,
      advName: decoded.name,
      lastAdvert: Math.floor(Date.now() / 1000),
      advLat: 0,
      advLon: 0,
      flags: 0,
      outPathLen: -1,
      outPath: new Uint8Array(64),
    });

    const storeId = deps.identityId;
    const previous = storeId != null ? getIdentityNodeMap(storeId).get(nodeId) : undefined;

    deps.skipMountDbHydrationCommit?.();

    if (storeId) {
      const next = new Map(getIdentityNodeMap(storeId));
      next.set(nodeId, { ...(previous ?? {}), ...node, on_radio: previous?.on_radio ?? false });
      syncNodesMapToIdentityStore(storeId, next);
    }

    const save = deps.saveContact ?? defaultSaveMeshcoreContact;
    const saved = await save({
      nodeId,
      publicKeyHex: decoded.publicKeyHex.toLowerCase(),
      name: decoded.name,
      contactType: decoded.type,
    });

    if (!saved) {
      if (storeId) {
        const rolled = new Map(getIdentityNodeMap(storeId));
        if (previous) rolled.set(nodeId, previous);
        else rolled.delete(nodeId);
        syncNodesMapToIdentityStore(storeId, rolled);
      }
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }

    return {
      ok: true,
      kind: 'contact',
      toastKey: 'qrIngest.meshcoreContactImported',
      nodeId,
      node: { ...(previous ?? {}), ...node, on_radio: previous?.on_radio ?? false },
      publicKey: bytes,
    };
  } catch (err) {
    console.error('[meshcoreQrIngest] importMeshcoreQr failed: ' + errLikeToLogString(err));
    return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
  }
}
