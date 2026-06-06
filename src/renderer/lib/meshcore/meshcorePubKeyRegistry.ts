import { pubkeyToNodeId } from '../meshcoreUtils';

const pubKeyByNodeId = new Map<number, Uint8Array>();
const pubKeyPrefixByHex = new Map<string, number>();

type MeshcorePubKeyRegistryRefSync = () => void;

let refSyncImpl: MeshcorePubKeyRegistryRefSync | null = null;

/** Registered by {@link useMeshcoreRuntime} to mirror maps into `pubKeyMapRef` / prefix ref. */
export function setMeshcorePubKeyRegistryRefSync(fn: MeshcorePubKeyRegistryRefSync | null): void {
  refSyncImpl = fn;
}

function prefixHexFromPubKey(publicKey: Uint8Array): string {
  return Array.from(publicKey.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function storePubKey(nodeId: number, publicKey: Uint8Array): void {
  pubKeyByNodeId.set(nodeId, publicKey);
  const prefixHex = prefixHexFromPubKey(publicKey);
  const existingNodeId = pubKeyPrefixByHex.get(prefixHex);
  if (existingNodeId != null && existingNodeId !== nodeId) {
    console.warn(
      `[meshcorePubKeyRegistry] 6-byte pubkey prefix collision prefix=${prefixHex} ` +
        `existing=0x${existingNodeId.toString(16)} new=0x${nodeId.toString(16)} — keeping first`,
    );
    return;
  }
  pubKeyPrefixByHex.set(prefixHex, nodeId);
}

function notifyRefSync(): void {
  refSyncImpl?.();
}

/** Register a 32-byte MeshCore pubkey for DM/trace and prefix-based RX decode. */
export function registerMeshcorePubKey(nodeId: number, publicKey: Uint8Array): void {
  if (publicKey.length !== 32 || nodeId === 0) return;
  storePubKey(nodeId, publicKey);
  notifyRefSync();
}

export function getMeshcorePubKey(nodeId: number): Uint8Array | undefined {
  return pubKeyByNodeId.get(nodeId);
}

export function resolveMeshcoreNodeIdFromPubKeyPrefix(prefixHex: string): number | undefined {
  return pubKeyPrefixByHex.get(prefixHex);
}

/** Seed per-subscription MeshCoreProtocol prefix maps from the global registry (post-connect contacts). */
export function seedMeshcorePrefixLookupMaps(
  nodeIdByPrefix: Map<string, number>,
  pubKeyByNodeIdOut: Map<number, Uint8Array>,
): void {
  for (const [nodeId, publicKey] of pubKeyByNodeId) {
    if (publicKey.length !== 32 || nodeId === 0) continue;
    pubKeyByNodeIdOut.set(nodeId, publicKey);
    nodeIdByPrefix.set(prefixHexFromPubKey(publicKey), nodeId);
  }
}

export function clearMeshcorePubKeyRegistry(): void {
  pubKeyByNodeId.clear();
  pubKeyPrefixByHex.clear();
  notifyRefSync();
}

/** Replace registry from a full contact sync (e.g. `buildNodesFromContacts`). */
export function replaceMeshcorePubKeyRegistry(entries: Iterable<[number, Uint8Array]>): void {
  pubKeyByNodeId.clear();
  pubKeyPrefixByHex.clear();
  for (const [nodeId, publicKey] of entries) {
    if (publicKey.length !== 32 || nodeId === 0) continue;
    storePubKey(nodeId, publicKey);
  }
  notifyRefSync();
}

/** Copy module-level maps into runtime refs (legacy hook compatibility). */
export function copyMeshcorePubKeyRegistryToRefs(
  pubKeyMapRef: Map<number, Uint8Array>,
  pubKeyPrefixMapRef: Map<string, number>,
): void {
  pubKeyMapRef.clear();
  pubKeyPrefixMapRef.clear();
  for (const [nodeId, key] of pubKeyByNodeId) {
    pubKeyMapRef.set(nodeId, key);
    pubKeyPrefixMapRef.set(prefixHexFromPubKey(key), nodeId);
  }
}

/** @internal Test helper */
export function meshcorePubKeyRegistrySize(): number {
  return pubKeyByNodeId.size;
}

/** Register from raw pubkey bytes (validates node id). */
export function registerMeshcorePubKeyBytes(publicKey: Uint8Array): number {
  const nodeId = pubkeyToNodeId(publicKey);
  if (nodeId === 0) return 0;
  registerMeshcorePubKey(nodeId, publicKey);
  return nodeId;
}
