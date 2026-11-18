/**
 * Coalesce per-packet / per-node store commits + SQLite persistence.
 *
 * Pending writes are visible to synchronous reads via {@link peekPendingNodeRecord}
 * (wired through {@link getIdentityNode}) before flush — last write wins per
 * identity/nodeId inside a window.
 *
 * Failure point: `db.saveNodes` — in-memory state is still applied; persistence
 * falls back to {@link persistDbWrite} retry queue. Flush on disconnect / quit
 * preserves integrity for the pending window.
 */

import { type NodeRecord, upsertNodeRecordsForIdentity } from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import { nodeRecordToMeshNode } from '../storeRecordAdapters';
import type { IdentityId, MeshNode } from '../types';

export const NODE_WRITE_COALESCE_MS = 250;
export const NODE_WRITE_FLUSH_MAX_PENDING = 500;
export const MAX_PENDING_NODE_WRITES = 8000;
export const NODE_BATCH_IPC_CHUNK_ROWS = 250;

export interface EnqueueNodeWriteOptions {
  /** Persist to SQLite on flush (default true). False for UI-only merges. */
  persist?: boolean;
  /**
   * Invoked once per dirty node at flush with the final MeshNode (diagnostics).
   * Last enqueue wins when multiple writes target the same node.
   */
  onFlushNode?: (node: MeshNode) => void;
}

interface IdentityPending {
  records: Map<number, NodeRecord>;
  persistTodos: Set<number>;
  onFlushByNode: Map<number, (node: MeshNode) => void>;
}

const pendingByIdentity = new Map<IdentityId, IdentityPending>();
/** Drained buckets still applying to the store / DB — readable until flushSnapshot finishes. */
const inFlightByIdentity = new Map<IdentityId, IdentityPending>();
let coalesceTimer: ReturnTimeout | undefined;
let flushing = false;
let capWarned = false;
let flushChain: Promise<void> = Promise.resolve();

type ReturnTimeout = ReturnType<typeof setTimeout>;

function totalPendingCount(): number {
  let n = 0;
  for (const bucket of pendingByIdentity.values()) n += bucket.records.size;
  return n;
}

function ensureBucket(identityId: IdentityId): IdentityPending {
  let bucket = pendingByIdentity.get(identityId);
  if (!bucket) {
    bucket = { records: new Map(), persistTodos: new Set(), onFlushByNode: new Map() };
    pendingByIdentity.set(identityId, bucket);
  }
  return bucket;
}

function armTimer(): void {
  if (coalesceTimer != null || flushing) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = undefined;
    void flushNodeWrites();
  }, NODE_WRITE_COALESCE_MS);
}

function clearTimer(): void {
  if (coalesceTimer == null) return;
  clearTimeout(coalesceTimer);
  coalesceTimer = undefined;
}

/** Queue a full NodeRecord for `identityId`/`record.nodeId`. Last write wins for that key. */
export function enqueueNodeWrite(
  identityId: IdentityId,
  record: NodeRecord,
  opts?: EnqueueNodeWriteOptions,
): void {
  const persist = opts?.persist !== false;
  const bucket = ensureBucket(identityId);
  bucket.records.set(record.nodeId, record);
  if (persist) bucket.persistTodos.add(record.nodeId);
  if (opts?.onFlushNode) bucket.onFlushByNode.set(record.nodeId, opts.onFlushNode);

  const total = totalPendingCount();
  if (total > MAX_PENDING_NODE_WRITES) {
    if (!capWarned) {
      capWarned = true;
      console.warn(
        `[coalescedNodeWrites] pending cap ${MAX_PENDING_NODE_WRITES} exceeded; forcing flush`,
      );
    }
    clearTimer();
    void flushNodeWrites();
    return;
  }
  if (total >= NODE_WRITE_FLUSH_MAX_PENDING) {
    clearTimer();
    void flushNodeWrites();
    return;
  }
  armTimer();
}

/** Pending record for read-through, or undefined. Newer pending beats in-flight drained. */
export function peekPendingNodeRecord(
  identityId: IdentityId,
  nodeId: number,
): NodeRecord | undefined {
  return (
    pendingByIdentity.get(identityId)?.records.get(nodeId) ??
    inFlightByIdentity.get(identityId)?.records.get(nodeId)
  );
}

/** True when a persist flush is queued or still applying for this node. */
export function hasPendingNodePersist(identityId: IdentityId, nodeId: number): boolean {
  return (
    pendingByIdentity.get(identityId)?.persistTodos.has(nodeId) === true ||
    inFlightByIdentity.get(identityId)?.persistTodos.has(nodeId) === true
  );
}

function mergeIntoInFlight(drained: Map<IdentityId, IdentityPending>): void {
  for (const [identityId, bucket] of drained) {
    const existing = inFlightByIdentity.get(identityId);
    if (!existing) {
      inFlightByIdentity.set(identityId, {
        records: new Map(bucket.records),
        persistTodos: new Set(bucket.persistTodos),
        onFlushByNode: new Map(bucket.onFlushByNode),
      });
      continue;
    }
    for (const [nodeId, record] of bucket.records) existing.records.set(nodeId, record);
    for (const nodeId of bucket.persistTodos) existing.persistTodos.add(nodeId);
    for (const [nodeId, onFlush] of bucket.onFlushByNode)
      existing.onFlushByNode.set(nodeId, onFlush);
  }
}

function clearDrainedFromInFlight(drained: Map<IdentityId, IdentityPending>): void {
  for (const [identityId, bucket] of drained) {
    const inflight = inFlightByIdentity.get(identityId);
    if (!inflight) continue;
    for (const [nodeId, record] of bucket.records) {
      // Drop only if still the same drained snapshot (newer enqueues replace the ref).
      if (inflight.records.get(nodeId) === record) {
        inflight.records.delete(nodeId);
        inflight.persistTodos.delete(nodeId);
        inflight.onFlushByNode.delete(nodeId);
      }
    }
    if (inflight.records.size === 0) inFlightByIdentity.delete(identityId);
  }
}

async function persistChunk(label: string, nodes: MeshNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const saveNodes = window.electronAPI.db.saveNodes;
  if (typeof saveNodes === 'function') {
    try {
      await saveNodes(nodes);
      return;
    } catch {
      // catch-no-log-ok: persistDbWrite queues retry / degraded warn
      persistDbWrite(label, () => saveNodes(nodes));
      return;
    }
  }
  // Fallback when batch IPC is unavailable (older preload / tests).
  for (const node of nodes) {
    persistDbWrite(label, () => window.electronAPI.db.saveNode(node));
  }
}

async function flushSnapshot(snapshot: Map<IdentityId, IdentityPending>): Promise<void> {
  // Sequential per identity — avoid stacking sync SQLite transactions from dual/triple radios.
  for (const [identityId, bucket] of snapshot) {
    const records = [...bucket.records.values()];
    if (records.length > 0) {
      upsertNodeRecordsForIdentity(identityId, records);
    }

    for (const [nodeId, onFlush] of bucket.onFlushByNode) {
      const record = bucket.records.get(nodeId);
      if (!record) continue;
      onFlush(nodeRecordToMeshNode(record));
    }

    const persistIds = [...bucket.persistTodos];
    if (persistIds.length === 0) continue;
    const meshNodes: MeshNode[] = [];
    for (const nodeId of persistIds) {
      const record = bucket.records.get(nodeId);
      if (record) meshNodes.push(nodeRecordToMeshNode(record));
    }
    for (let i = 0; i < meshNodes.length; i += NODE_BATCH_IPC_CHUNK_ROWS) {
      const chunk = meshNodes.slice(i, i + NODE_BATCH_IPC_CHUNK_ROWS);
      await persistChunk(`coalesced node batch ${identityId}`, chunk);
    }
  }
}

/** Flush immediately (disconnect, identity reset, beforeunload, tests). Idempotent. */
export function flushNodeWrites(): Promise<void> {
  clearTimer();
  if (pendingByIdentity.size === 0 && !flushing) return flushChain;

  // Swap pending maps so re-entrant enqueues during flush are not lost.
  const drained = new Map(pendingByIdentity);
  pendingByIdentity.clear();
  mergeIntoInFlight(drained);

  flushChain = flushChain.then(async () => {
    flushing = true;
    try {
      await flushSnapshot(drained);
    } finally {
      clearDrainedFromInFlight(drained);
      flushing = false;
      if (pendingByIdentity.size > 0 && coalesceTimer == null) {
        armTimer();
      }
    }
  });
  return flushChain;
}

/** Test-only reset: clears pending state + timers. */
export function resetCoalescedNodeWritesForTests(): void {
  clearTimer();
  pendingByIdentity.clear();
  inFlightByIdentity.clear();
  flushing = false;
  capWarned = false;
  flushChain = Promise.resolve();
}

function onBeforeUnload(): void {
  void flushNodeWrites();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', onBeforeUnload);
}
