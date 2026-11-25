/** In-memory auto-login failure state per room (survives radio disconnect until cleared). */

export type AutoLoginFailureListener = () => void;

interface AutoLoginFailureEntry {
  message: string;
  /** Auth failures stickily skip connect auto-login; transient ones are UI-only. */
  stickySkip: boolean;
}

const failures = new Map<number, AutoLoginFailureEntry>();
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
  return failures.get(nodeId >>> 0)?.message;
}

/** True when connect auto-login must skip this room (auth / ACL sticky failure). */
export function shouldSkipMeshcoreRoomAutoLogin(nodeId: number): boolean {
  return failures.get(nodeId >>> 0)?.stickySkip === true;
}

export function setMeshcoreRoomAutoLoginFailure(
  nodeId: number,
  errorMessage: string,
  opts?: { stickySkip?: boolean },
): void {
  const id = nodeId >>> 0;
  const msg = errorMessage.trim();
  if (!msg) return;
  const stickySkip = opts?.stickySkip === true;
  const prev = failures.get(id);
  if (prev?.message === msg && prev.stickySkip === stickySkip) return;
  failures.set(id, { message: msg, stickySkip });
  notifyAutoLoginFailureChanged();
}

export function clearMeshcoreRoomAutoLoginFailure(nodeId: number): void {
  const id = nodeId >>> 0;
  if (!failures.has(id)) return;
  failures.delete(id);
  notifyAutoLoginFailureChanged();
}

/** Clear UI-only (non-auth) failures so reconnect can retry auto-login. */
export function clearTransientMeshcoreRoomAutoLoginFailures(): void {
  let changed = false;
  for (const [id, entry] of failures) {
    if (entry.stickySkip) continue;
    failures.delete(id);
    changed = true;
  }
  if (changed) notifyAutoLoginFailureChanged();
}

export function clearAllMeshcoreRoomAutoLoginFailures(): void {
  if (failures.size === 0) return;
  failures.clear();
  notifyAutoLoginFailureChanged();
}
