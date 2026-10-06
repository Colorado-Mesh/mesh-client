import { meshtasticNodeNumFromPublicKeyHex } from '@/shared/meshtasticNodeNumFromPublicKey';

import { remapMessageNodeId } from '../../stores/messageStore';
import {
  type NodeRecord,
  patchNodeFavorited,
  removeNode,
  useNodeStore,
} from '../../stores/nodeStore';
import { errLikeToLogString } from '../errLikeToLogString';
import { moveMeshtasticRemoteAdminKeyToNode } from '../meshtasticRemoteAdminKeyStorage';
import { MESHTASTIC_RENUMBER_OLD_NODE_QUIET_MS } from '../timeConstants';
import type { IdentityId } from '../types';

const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/;
const ZERO_PUBLIC_KEY_HEX = '0'.repeat(64);

/** Per identity: Meshtastic PKC public key (lowercase hex) -> node number it was last seen on. */
const nodeNumByPublicKey = new Map<IdentityId, Map<string, number>>();

function normalizePublicKeyHex(raw: string | undefined): string | null {
  if (!raw) return null;
  const hex = raw.toLowerCase();
  if (!PUBLIC_KEY_HEX_RE.test(hex) || hex === ZERO_PUBLIC_KEY_HEX) return null;
  return hex;
}

function storedNode(identityId: IdentityId, nodeNum: number): NodeRecord | undefined {
  const { nodes } = useNodeStore.getState();
  if (!(identityId in nodes)) return undefined;
  const byId = nodes[identityId];
  return nodeNum in byId ? byId[nodeNum] : undefined;
}

function isValidNodeNum(nodeNum: number): boolean {
  return Number.isInteger(nodeNum) && nodeNum > 0 && nodeNum < 0xffffffff;
}

/** Index rebuilt from the node store on a key miss; the querying node is skipped so it cannot shadow an older number. */
function rebuildIndex(identityId: IdentityId, excludeNodeNum: number): Map<string, number> {
  const index = new Map<string, number>();
  const byId = useNodeStore.getState().nodes[identityId] ?? {};
  for (const record of Object.values(byId)) {
    if (record.nodeId === excludeNodeNum) continue;
    const key = normalizePublicKeyHex(record.publicKeyHex);
    if (key) index.set(key, record.nodeId);
  }
  nodeNumByPublicKey.set(identityId, index);
  return index;
}

/**
 * Returns the node number this public key previously used when it now arrives under
 * `nodeNum`, or null. Only a firmware 2.8 renumber qualifies: `nodeNum` must equal
 * crc32(public key). A stale replay of the old number (radio NodeDB still holding it)
 * never wins over the newer number.
 */
export function findRenumberedMeshtasticNode(
  identityId: IdentityId,
  nodeNum: number,
  publicKeyHex: string | undefined,
  incomingLastHeardMs: number,
  nowMs: number = Date.now(),
): number | null {
  const key = normalizePublicKeyHex(publicKeyHex);
  if (!key || !isValidNodeNum(nodeNum)) return null;
  const cached = nodeNumByPublicKey.get(identityId);
  const index = cached?.has(key) ? cached : rebuildIndex(identityId, nodeNum);
  const previous = index.get(key);
  if (previous === undefined || previous === nodeNum) {
    index.set(key, nodeNum);
    return null;
  }

  const old = storedNode(identityId, previous);
  if (normalizePublicKeyHex(old?.publicKeyHex) !== key) {
    index.set(key, nodeNum);
    return null;
  }
  const oldLastHeardMs = old?.lastHeardAt ?? 0;
  if (incomingLastHeardMs <= oldLastHeardMs) return null;
  // Leave the index on the old number when this sighting is refused. Latching the
  // new number here makes the next packet look like `previous === nodeNum` and
  // skips the migration for the rest of the session.
  if (meshtasticNodeNumFromPublicKeyHex(key) !== nodeNum) {
    console.debug(
      `[meshtasticNodeRenumber] !${nodeNum.toString(16)} is not crc32 of its public key; not merging !${previous.toString(16)}`,
    );
    return null;
  }
  if (oldLastHeardMs > nowMs - MESHTASTIC_RENUMBER_OLD_NODE_QUIET_MS) {
    console.warn(
      `[meshtasticNodeRenumber] public key seen on !${nodeNum.toString(16)} while !${previous.toString(16)} is still active; not merging`,
    );
    return null;
  }
  index.set(key, nodeNum);
  return previous;
}

/** Move history for a renumbered node in SQLite, then mirror the result in the in-memory stores. */
export async function migrateRenumberedMeshtasticNode(
  identityId: IdentityId,
  oldNodeNum: number,
  newNodeNum: number,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const result = await window.electronAPI.db.migrateMeshtasticNodeNum(
      oldNodeNum,
      newNodeNum,
      publicKeyHex.toLowerCase(),
    );
    if (!result?.migrated) return false;
    const old = storedNode(identityId, oldNodeNum);
    if (old?.favorited) patchNodeFavorited(identityId, newNodeNum, true);
    removeNode(identityId, oldNodeNum);
    remapMessageNodeId(identityId, oldNodeNum, newNodeNum);
    await moveMeshtasticRemoteAdminKeyToNode(oldNodeNum, newNodeNum);
    console.info(
      `[meshtasticNodeRenumber] node !${oldNodeNum.toString(16)} is now !${newNodeNum.toString(16)}; moved ${result.messagesUpdated} messages`,
    );
    return true;
  } catch (e: unknown) {
    console.warn('[meshtasticNodeRenumber] migrate failed ' + errLikeToLogString(e));
    return false;
  }
}

/** Detect and migrate in one step; the migration runs in the background. */
export function maybeMigrateRenumberedMeshtasticNode(
  identityId: IdentityId,
  nodeNum: number,
  publicKeyHex: string | undefined,
  incomingLastHeardMs: number,
): void {
  const oldNodeNum = findRenumberedMeshtasticNode(
    identityId,
    nodeNum,
    publicKeyHex,
    incomingLastHeardMs,
  );
  if (oldNodeNum == null || !publicKeyHex) return;
  void migrateRenumberedMeshtasticNode(identityId, oldNodeNum, nodeNum, publicKeyHex);
}

/** @internal Test helper. */
export function resetMeshtasticRenumberIndexForTests(): void {
  nodeNumByPublicKey.clear();
}
