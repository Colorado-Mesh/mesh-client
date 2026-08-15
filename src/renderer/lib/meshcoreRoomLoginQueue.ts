import { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE } from './meshcoreRoomLoginRpc';
import {
  MESHCORE_ROOM_LOGIN_QUEUE_SKIP_POLL_MS,
  MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS,
} from './timeConstants';

/** One radio login at a time; many rooms can be queued. */
let chain: Promise<void> = Promise.resolve();
let activeNodeId: number | null = null;
const pendingNodeIds = new Set<number>();
/** Bumped on enqueue and dequeue so a cancelled pending job cannot be revived. */
const jobGenerationByNode = new Map<number, number>();
let lastMeshLoginTxAt = 0;

type QueueListener = () => void;
const queueListeners = new Set<QueueListener>();

function notifyQueueChanged(): void {
  for (const listener of queueListeners) {
    listener();
  }
}

function bumpJobGeneration(nodeId: number): number {
  const next = (jobGenerationByNode.get(nodeId) ?? 0) + 1;
  jobGenerationByNode.set(nodeId, next);
  return next;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait up to `ms`, returning early when this job's generation is stale (cancelled). */
async function sleepMsUnlessStale(ms: number, nodeId: number, gen: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (jobGenerationByNode.get(nodeId) !== gen) return;
    const slice = Math.min(MESHCORE_ROOM_LOGIN_QUEUE_SKIP_POLL_MS, deadline - Date.now());
    if (slice <= 0) return;
    await sleepMs(slice);
  }
}

function throwIfJobStale(nodeId: number, gen: number): void {
  if (jobGenerationByNode.get(nodeId) !== gen) {
    throw new DOMException(MESHCORE_ROOM_LOGIN_ABORT_MESSAGE, 'AbortError');
  }
}

export function getMeshcoreRoomLoginQueueSnapshot(): {
  activeNodeId: number | null;
  pendingNodeIds: number[];
} {
  return {
    activeNodeId,
    pendingNodeIds: [...pendingNodeIds],
  };
}

export function subscribeMeshcoreRoomLoginQueueChanges(listener: QueueListener): () => void {
  queueListeners.add(listener);
  return () => {
    queueListeners.delete(listener);
  };
}

export function meshcoreIsRoomLoginQueued(nodeId: number): boolean {
  return activeNodeId === nodeId || pendingNodeIds.has(nodeId);
}

export function meshcoreRoomLoginQueueSize(): number {
  return pendingNodeIds.size + (activeNodeId != null ? 1 : 0);
}

/**
 * Enqueue a room login (FIFO). Resolves when this room's login attempt finishes.
 * Failure point: prior jobs block the queue — callers should not assume immediate start.
 */
export function enqueueMeshcoreRoomLogin(nodeId: number, run: () => Promise<void>): Promise<void> {
  const gen = bumpJobGeneration(nodeId);
  pendingNodeIds.add(nodeId);
  notifyQueueChanged();

  const job = chain.then(async () => {
    pendingNodeIds.delete(nodeId);
    throwIfJobStale(nodeId, gen);
    activeNodeId = nodeId;
    notifyQueueChanged();
    const waitMs =
      lastMeshLoginTxAt > 0
        ? Math.max(0, MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS - (Date.now() - lastMeshLoginTxAt))
        : 0;
    if (waitMs > 0) {
      await sleepMsUnlessStale(waitMs, nodeId, gen);
    }
    throwIfJobStale(nodeId, gen);
    try {
      await run();
      lastMeshLoginTxAt = Date.now();
    } finally {
      if (activeNodeId === nodeId) {
        activeNodeId = null;
      }
      notifyQueueChanged();
    }
  });

  chain = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

/** Remove a room from the pending queue (does not abort an already-started run()). */
export function dequeueMeshcoreRoomLogin(nodeId: number): void {
  bumpJobGeneration(nodeId);
  pendingNodeIds.delete(nodeId);
  notifyQueueChanged();
}

/** Skip all pending logins; active login must be aborted separately. */
export function clearMeshcoreRoomLoginQueue(): void {
  for (const nodeId of pendingNodeIds) {
    bumpJobGeneration(nodeId);
  }
  pendingNodeIds.clear();
  notifyQueueChanged();
}

/** Reset queue state (tests / disconnect). */
export function resetMeshcoreRoomLoginQueue(): void {
  chain = Promise.resolve();
  activeNodeId = null;
  pendingNodeIds.clear();
  jobGenerationByNode.clear();
  lastMeshLoginTxAt = 0;
  notifyQueueChanged();
}
