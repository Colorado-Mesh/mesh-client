/**
 * MeshCore TCP init tolerates peer FIN after the contacts burst is captured.
 * Shared predicates for initConn / getChannels skip paths and reconnect deferral.
 */

export function isMeshcoreTcpBurstDeadBridge(opts: {
  transportType: string;
  burstCaptured: boolean;
  bridgeDead: boolean;
}): boolean {
  return opts.transportType === 'tcp' && opts.burstCaptured && opts.bridgeDead;
}

/**
 * Defer reconnect while this open can still finish from the contacts burst / remaining init.
 * Uses !everConfigured so a late tcp-disconnected after a premature deviceConfigured
 * (Neal: getChannels raced ahead of IPC) cannot abort before connect() latches everConfigured.
 * Uses !deviceConfigured so mid-reconnect opens (everConfigured already true) still defer.
 * Mid-reconnect FIN often races getContacts resolve (burst flag not set yet) — defer whenever
 * everConfigured && !deviceConfigured even without burstCaptured.
 * Configure-before-dump: deviceConfigured+everConfigured are both true during getChannels —
 * still defer while initConn is in flight after the burst so peer FIN does not bump setup gen.
 */
export function shouldDeferMeshcoreTcpReconnectAfterBurst(opts: {
  burstCaptured: boolean;
  everConfigured: boolean;
  deviceConfigured: boolean;
  initConnInFlight?: boolean;
}): boolean {
  if (opts.initConnInFlight && opts.burstCaptured) {
    return true;
  }
  if (opts.deviceConfigured && opts.everConfigured) {
    return false;
  }
  if (opts.everConfigured && !opts.deviceConfigured) {
    return true;
  }
  return opts.burstCaptured;
}

type MeshcoreTcpWriteDeadListener = () => void;

let meshcoreTcpWriteDeadListener: MeshcoreTcpWriteDeadListener | null = null;

/** Runtime registers a latch so IpcTcpConnection write failures mark the bridge dead without waiting for IPC. */
export function setMeshcoreTcpWriteDeadListener(
  listener: MeshcoreTcpWriteDeadListener | null,
): void {
  meshcoreTcpWriteDeadListener = listener;
}

/** Called from IpcTcpConnection when meshcore:tcp-write fails (no active socket / peer FIN). */
export function notifyMeshcoreTcpWriteDead(): void {
  meshcoreTcpWriteDeadListener?.();
}
