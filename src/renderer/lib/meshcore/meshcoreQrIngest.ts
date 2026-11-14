/**
 * MeshCore QR classify + contact import (DB + identity node store).
 * Share QR already lives on NodeDetailModal; scan entry points use this module.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { syncNodesMapToIdentityStore } from '@/renderer/lib/hydrateIdentityStoresFromDb';
import { getIdentityNodeMap } from '@/renderer/lib/identityStoreReads';
import { meshcoreContactToMeshNode, pubkeyToNodeId } from '@/renderer/lib/meshcoreUtils';
import type { MeshNode } from '@/renderer/lib/types';
import { removeNode } from '@/renderer/stores/nodeStore';
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
  /**
   * Persist contact; returns false on failure.
   * Defaults to SQLite with the contact’s existing `on_radio` (0 when new).
   */
  saveContact?: (opts: {
    nodeId: number;
    publicKeyHex: string;
    name: string;
    contactType: number;
    onRadio: boolean;
  }) => Promise<boolean>;
}

async function defaultSaveMeshcoreContact(opts: {
  nodeId: number;
  publicKeyHex: string;
  name: string;
  contactType: number;
  onRadio: boolean;
}): Promise<boolean> {
  try {
    await window.electronAPI.db.saveMeshcoreContact({
      node_id: opts.nodeId,
      public_key: opts.publicKeyHex.toLowerCase(),
      adv_name: opts.name,
      contact_type: opts.contactType,
      on_radio: opts.onRadio ? 1 : 0,
    });
    return true;
  } catch (err) {
    console.error('[meshcoreQrIngest] saveMeshcoreContact failed: ' + errLikeToLogString(err));
    return false;
  }
}

/**
 * Merge QR-imported identity fields onto an existing contact without clobbering
 * coordinates / SNR / battery with QR placeholder nulls and zeros.
 */
export function mergeMeshcoreQrContactNode(
  previous: MeshNode | undefined,
  imported: MeshNode,
): MeshNode {
  if (!previous) {
    return { ...imported, on_radio: false };
  }
  const latitude =
    imported.latitude != null && imported.latitude !== 0 ? imported.latitude : previous.latitude;
  const longitude =
    imported.longitude != null && imported.longitude !== 0
      ? imported.longitude
      : previous.longitude;
  return {
    ...previous,
    long_name: imported.long_name,
    short_name: imported.short_name,
    hw_model: imported.hw_model,
    last_heard: imported.last_heard,
    ...(imported.public_key_hex != null ? { public_key_hex: imported.public_key_hex } : {}),
    ...(imported.hops_away !== undefined ? { hops_away: imported.hops_away } : {}),
    latitude,
    longitude,
    snr: imported.snr !== 0 ? imported.snr : previous.snr,
    battery: imported.battery !== 0 ? imported.battery : previous.battery,
    on_radio: previous.on_radio ?? false,
  };
}

function rollbackOptimisticQrContact(
  storeId: string,
  nodeId: number,
  previous: MeshNode | undefined,
): void {
  if (previous) {
    const rolled = new Map(getIdentityNodeMap(storeId));
    rolled.set(nodeId, previous);
    syncNodesMapToIdentityStore(storeId, rolled);
    return;
  }
  removeNode(storeId, nodeId);
}

/**
 * Classify decoded QR text and apply MeshCore contact imports immediately
 * (identity store + SQLite). Channel / unsupported kinds are returned for the caller to route.
 * Works offline — contact import is DB-only unless the contact was already on radio.
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

  const storeId = deps.identityId;
  let previous: MeshNode | undefined;
  let nodeId: number | undefined;

  try {
    const bytes = hexToBytesExact(decoded.publicKeyHex, 32);
    if (!bytes) {
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }
    nodeId = pubkeyToNodeId(bytes);
    if (nodeId === 0) {
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }

    const imported = meshcoreContactToMeshNode({
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

    previous = storeId != null ? getIdentityNodeMap(storeId).get(nodeId) : undefined;
    const node = mergeMeshcoreQrContactNode(previous, imported);
    const onRadio = previous?.on_radio === true;

    deps.skipMountDbHydrationCommit?.();

    if (storeId) {
      const next = new Map(getIdentityNodeMap(storeId));
      next.set(nodeId, node);
      syncNodesMapToIdentityStore(storeId, next);
    }

    const save = deps.saveContact ?? defaultSaveMeshcoreContact;
    const saved = await save({
      nodeId,
      publicKeyHex: decoded.publicKeyHex.toLowerCase(),
      name: decoded.name,
      contactType: decoded.type,
      onRadio,
    });

    if (!saved) {
      if (storeId) rollbackOptimisticQrContact(storeId, nodeId, previous);
      return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
    }

    return {
      ok: true,
      kind: 'contact',
      toastKey: 'qrIngest.meshcoreContactImported',
      nodeId,
      node,
      publicKey: bytes,
    };
  } catch (err) {
    console.error('[meshcoreQrIngest] importMeshcoreQr failed: ' + errLikeToLogString(err));
    if (storeId != null && nodeId != null) {
      rollbackOptimisticQrContact(storeId, nodeId, previous);
    }
    return { ok: false, kind: 'contact', toastKey: 'qrIngest.meshcoreContactImportFailed' };
  }
}
