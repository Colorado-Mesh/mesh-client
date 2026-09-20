/**
 * Cross-component signal: Connection issue alert → Admin tab → expand RNode flasher
 * Bluetooth (Clear paired / Start pairing).
 *
 * Admin panel may be unmounted until the tab activates, so we keep a pending flag
 * that the panel consumes on mount / when the nonce bumps.
 */

let pendingAdminBluetoothFocus = false;
let focusNonce = 0;
const listeners = new Set<() => void>();

/** Request Admin → RNode flasher → Bluetooth focus (call after switching to Admin tab). */
export function requestReticulumAdminBluetoothFocus(): number {
  pendingAdminBluetoothFocus = true;
  focusNonce += 1;
  for (const listener of listeners) {
    listener();
  }
  return focusNonce;
}

/** True if a focus was requested and not yet consumed. */
export function peekReticulumAdminBluetoothFocusPending(): boolean {
  return pendingAdminBluetoothFocus;
}

/** Consume a pending focus request (idempotent). Returns true if one was pending. */
export function consumeReticulumAdminBluetoothFocus(): boolean {
  if (!pendingAdminBluetoothFocus) return false;
  pendingAdminBluetoothFocus = false;
  return true;
}

/** Subscribe to focus requests (Admin panel mounts late). */
export function subscribeReticulumAdminBluetoothFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: reset module state. */
export function resetReticulumAdminBluetoothFocusForTests(): void {
  pendingAdminBluetoothFocus = false;
  focusNonce = 0;
  listeners.clear();
}
