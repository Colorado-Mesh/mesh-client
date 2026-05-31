/** In-memory auto-login failure state per room (survives radio disconnect until cleared). */

type AutoLoginFailureListener = () => void;

const failures = new Map<number, string>();
const listeners = new Set<AutoLoginFailureListener>();

function notifyAutoLoginFailureChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeMeshcoreRoomAutoLoginFailureChanges(
  cb: AutoLoginFailureListener,
): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getMeshcoreRoomAutoLoginFailure(nodeId: number): string | undefined {
  return failures.get(nodeId >>> 0);
}

export function setMeshcoreRoomAutoLoginFailure(nodeId: number, errorMessage: string): void {
  const id = nodeId >>> 0;
  const msg = errorMessage.trim();
  if (!msg) return;
  if (failures.get(id) === msg) return;
  failures.set(id, msg);
  notifyAutoLoginFailureChanged();
}

export function clearMeshcoreRoomAutoLoginFailure(nodeId: number): void {
  const id = nodeId >>> 0;
  if (!failures.has(id)) return;
  failures.delete(id);
  notifyAutoLoginFailureChanged();
}

export function clearAllMeshcoreRoomAutoLoginFailures(): void {
  if (failures.size === 0) return;
  failures.clear();
  notifyAutoLoginFailureChanged();
}
