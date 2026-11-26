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

import {
  type NodeRecord,
  upsertNodeRecordsForIdentity,
  useNodeStore,
} from '../../stores/nodeStore';
import { persistDbWrite } from '../dbPersistRetry';
import { nodeRecordToMeshNode } from '../storeRecordAdapters';
import type { IdentityId, MeshNode } from '../types';

export const NODE_WRITE_COALESCE_MS = 250;
export const NODE_WRITE_FLUSH_MAX_PENDING = 500;
export const MAX_PENDING_NODE_WRITES = 8000;
const NODE_BATCH_IPC_CHUNK_ROWS = 250;

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
        `mcL0848 [coalescedNodeWrites] pending cap ${MAX_PENDING_NODE_WRITES} exceeded; forcing flush`,
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

let persistDropWarned = false;

/**
 * Pending keys to layer onto a live {@link NodeRecord}.
 * Undefined values are omitted so session-only store fields (noiseFloor) survive a coalesced
 * snapshot that never wrote them — except intentional clears for hopsAway / lastPositionWarning.
 */
export function pendingNodeRecordMergeFields(record: NodeRecord): Partial<NodeRecord> {
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => {
      if (value !== undefined) return true;
      return key === 'hopsAway' || key === 'lastPositionWarning';
    }),
  );
}

function reconcilePendingRecordWithStore(identityId: IdentityId, pending: NodeRecord): NodeRecord {
  const byId = useNodeStore.getState().nodes[identityId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- identity bucket may be absent at runtime
  if (!byId?.[pending.nodeId]) return pending;
  const live = byId[pending.nodeId];
  const liveLh = live.lastHeardAt ?? 0;
  const pendingLh = pending.lastHeardAt ?? 0;
  // Merge pending onto live so session-only store fields (noiseFloor) survive a
  // coalesced write that omitted them (updateTelemetry bypasses the pending queue).
  const merged: NodeRecord = {
    ...live,
    ...pendingNodeRecordMergeFields(pending),
    nodeId: pending.nodeId,
    lastHeardAt: liveLh > pendingLh ? liveLh : (pending.lastHeardAt ?? live.lastHeardAt),
  };
  return merged;
}

function buildPersistMeshNodes(identityId: IdentityId, nodeIds: readonly number[]): MeshNode[] {
  const meshNodes: MeshNode[] = [];
  for (const nodeId of nodeIds) {
    const pending = peekPendingNodeRecord(identityId, nodeId);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- identity bucket may be absent at runtime
    const storeRecord = useNodeStore.getState().nodes[identityId]?.[nodeId];
    const base = pending ?? storeRecord;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- pending/in-flight may clear before async retry
    if (!base) continue;
    meshNodes.push(nodeRecordToMeshNode(reconcilePendingRecordWithStore(identityId, base)));
  }
  return meshNodes;
}

async function persistChunk(
  label: string,
  identityId: IdentityId,
  nodeIds: readonly number[],
): Promise<void> {
  if (nodeIds.length === 0) return;
  const saveNodes = window.electronAPI.db.saveNodes;
  const persistBatch = async (): Promise<void> => {
    const nodes = buildPersistMeshNodes(identityId, nodeIds);
    if (nodes.length === 0) return;
    const result = await saveNodes(nodes);
    const dropped = result.dropped;
    const saved = result.saved;
    if (dropped > 0 || saved < nodes.length) {
      if (dropped > 0 && !persistDropWarned) {
        persistDropWarned = true;
        console.warn(
          `mcL0849 [coalescedNodeWrites] ${label}: saveNodes dropped ${dropped} row(s); queueing retry`,
        );
      }
      throw new Error(
        `[coalescedNodeWrites] ${label}: saveNodes incomplete (saved=${saved}, dropped=${dropped}, expected=${nodes.length})`,
      );
    }
  };
  if (typeof saveNodes === 'function') {
    try {
      await persistBatch();
    } catch (e: unknown) {
      console.debug('[renderer/lib/ingest/coalescedNodeWrites] catch:', e);

      persistDbWrite(label, persistBatch);
    }
    return;
  }
  // Fallback when batch IPC is unavailable (older preload / tests).
  for (const node of buildPersistMeshNodes(identityId, nodeIds)) {
    persistDbWrite(label, () => window.electronAPI.db.saveNode(node));
  }
}

async function flushSnapshot(snapshot: Map<IdentityId, IdentityPending>): Promise<void> {
  // Sequential per identity — avoid stacking sync SQLite transactions from dual/triple radios.
  for (const [identityId, bucket] of snapshot) {
    const reconciledByNode = new Map<number, NodeRecord>();
    for (const record of bucket.records.values()) {
      reconciledByNode.set(record.nodeId, reconcilePendingRecordWithStore(identityId, record));
    }
    const records = [...reconciledByNode.values()];
    if (records.length > 0) {
      upsertNodeRecordsForIdentity(identityId, records);
    }

    for (const [nodeId, onFlush] of bucket.onFlushByNode) {
      const record = reconciledByNode.get(nodeId);
      if (!record) continue;
      onFlush(nodeRecordToMeshNode(record));
    }

    const persistIds = [...bucket.persistTodos];
    if (persistIds.length === 0) continue;
    for (let i = 0; i < persistIds.length; i += NODE_BATCH_IPC_CHUNK_ROWS) {
      const chunkIds = persistIds.slice(i, i + NODE_BATCH_IPC_CHUNK_ROWS);
      await persistChunk(`coalesced node batch ${identityId}`, identityId, chunkIds);
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
  persistDropWarned = false;
  flushChain = Promise.resolve();
}

function onBeforeUnload(): void {
  void flushNodeWrites();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', onBeforeUnload);
}
