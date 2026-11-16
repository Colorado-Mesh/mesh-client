import { type NodeRecord, useNodeStore } from '../../stores/nodeStore';
import { meshcoreIsSyntheticPlaceholderPubKeyHex, pubkeyToNodeId } from '../meshcoreUtils';
import { tryGetMeshcoreSession } from '../sessions/meshcoreSession';
import type { IdentityId } from '../types';
import { getMeshcorePubKey } from './meshcorePubKeyRegistry';

function meshcorePubKeyMatchesNodeId(pubKey: Uint8Array, nodeId: number): boolean {
  return pubKey.length === 32 && pubkeyToNodeId(pubKey) === nodeId;
}

/** 32-byte pubkey from hex, or null if synthetic / invalid. */
function meshcorePubKeyBytesFromHex(raw: string): Uint8Array | null {
  const hex = raw.replace(/\s/g, '');
  if (meshcoreIsSyntheticPlaceholderPubKeyHex(hex)) return null;
  // Require exactly 64 hex digits before parseInt — non-hex pairs would become 0 bytes.
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const pairs = hex.match(/.{2}/g);
  if (pairs?.length !== 32) return null;
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

function acceptMatchingPubKey(
  nodeId: number,
  pubKey: Uint8Array | undefined,
): Uint8Array | undefined {
  if (pubKey && meshcorePubKeyMatchesNodeId(pubKey, nodeId)) return pubKey;
  return undefined;
}

function acceptMatchingPubKeyHex(
  nodeId: number,
  hex: string | undefined | null,
): Uint8Array | undefined {
  if (!hex?.trim()) return undefined;
  const bytes = meshcorePubKeyBytesFromHex(hex);
  return acceptMatchingPubKey(nodeId, bytes ?? undefined);
}

export interface ResolveMeshcoreDestinationPubKeySyncOpts {
  /** Live NodeStore `publicKey` bytes when already loaded. */
  storePublicKey?: Uint8Array;
  /** Live NodeStore `publicKeyHex` (MeshCore contact sync often has hex only). */
  storePublicKeyHex?: string | null;
  /** MeshNode / UI `public_key_hex` when the modal or chat row has it. */
  meshNodePublicKeyHex?: string | null;
}

/**
 * Sync MeshCore DM destination pubkey resolution.
 * Order: store bytes → store hex → MeshNode hex → global registry → session map.
 * Rejects synthetic placeholders and keys that do not hash to `nodeId`.
 */
export function resolveMeshcoreDestinationPubKeySync(
  nodeId: number,
  opts: ResolveMeshcoreDestinationPubKeySyncOpts = {},
): Uint8Array | undefined {
  if (nodeId <= 0) return undefined;

  return (
    acceptMatchingPubKey(nodeId, opts.storePublicKey) ??
    acceptMatchingPubKeyHex(nodeId, opts.storePublicKeyHex) ??
    acceptMatchingPubKeyHex(nodeId, opts.meshNodePublicKeyHex) ??
    acceptMatchingPubKey(nodeId, getMeshcorePubKey(nodeId)) ??
    acceptMatchingPubKey(nodeId, tryGetMeshcoreSession()?.getDestinationPubKey?.(nodeId))
  );
}

function nodeRecordOf(identityId: IdentityId, nodeId: number): NodeRecord | undefined {
  const byId = useNodeStore.getState().nodes[identityId] as
    Record<number, NodeRecord | undefined> | undefined;
  return byId?.[nodeId];
}

/** Convenience: resolve from identity-scoped NodeStore + optional MeshNode hex. */
export function resolveMeshcoreDestinationPubKeyForIdentity(
  identityId: IdentityId,
  nodeId: number,
  meshNodePublicKeyHex?: string | null,
): Uint8Array | undefined {
  const record = nodeRecordOf(identityId, nodeId);
  return resolveMeshcoreDestinationPubKeySync(nodeId, {
    storePublicKey: record?.publicKey,
    storePublicKeyHex: record?.publicKeyHex,
    meshNodePublicKeyHex,
  });
}

/** True when a MeshCore DM to `nodeId` has a sync-resolvable encryption key. */
export function hasMeshcoreDestinationPubKey(
  identityId: IdentityId,
  nodeId: number,
  meshNodePublicKeyHex?: string | null,
): boolean {
  return (
    resolveMeshcoreDestinationPubKeyForIdentity(identityId, nodeId, meshNodePublicKeyHex) != null
  );
}

/** Lowercase hex for UI (`contactPubkey`), or null when unresolved. */
export function resolveMeshcoreDestinationPubKeyHexSync(
  nodeId: number,
  opts: ResolveMeshcoreDestinationPubKeySyncOpts = {},
): string | null {
  const bytes = resolveMeshcoreDestinationPubKeySync(nodeId, opts);
  if (!bytes) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
