/**
 * Synchronous, identity-scoped reads of the canonical Zustand stores.
 *
 * `PacketRouter` / ingest write every decoded packet into `nodeStore` /
 * `messageStore`. Runtime send, dedup, and RPC paths read through these helpers
 * so there is a single ingress destination (no hook-local node/message mirrors).
 *
 * Failure point: none — a missing identity or bucket yields an empty result and
 * callers fall back to their own defaults.
 */
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import {
  messageRecordsToChatMessages,
  nodeRecordsToMeshNodeMap,
  nodeRecordToMeshNode,
} from './storeRecordAdapters';
import type { ChatMessage, MeshNode } from './types';

const EMPTY_NODES: ReadonlyMap<number, MeshNode> = new Map();
const EMPTY_MESSAGES: readonly ChatMessage[] = [];

/**
 * Full node map for an identity. `nodeRecordsToMeshNodeMap` memoizes the export,
 * so repeated calls on unchanged store state reuse the previous map.
 */
export function getIdentityNodeMap(identityId: string | null | undefined): Map<number, MeshNode> {
  if (!identityId) return new Map(EMPTY_NODES);
  const byId = useNodeStore.getState().nodes[identityId];
  if (!byId) return new Map(EMPTY_NODES);
  return nodeRecordsToMeshNodeMap(Object.values(byId));
}

/** Single node lookup — avoids converting the whole bucket on hot packet paths. */
export function getIdentityNode(
  identityId: string | null | undefined,
  nodeId: number,
): MeshNode | undefined {
  if (!identityId || !nodeId) return undefined;
  const record = useNodeStore.getState().nodes[identityId]?.[nodeId];
  return record ? nodeRecordToMeshNode(record) : undefined;
}

/** Chat rows for an identity, in the shape UI and dedup helpers expect. */
export function getIdentityChatMessages(identityId: string | null | undefined): ChatMessage[] {
  if (!identityId) return [...EMPTY_MESSAGES];
  const byId = useMessageStore.getState().messages[identityId];
  if (!byId) return [...EMPTY_MESSAGES];
  return messageRecordsToChatMessages(Object.values(byId));
}
