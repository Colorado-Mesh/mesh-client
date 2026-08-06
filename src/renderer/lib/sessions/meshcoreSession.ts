/** MeshCore RF transport type for session attach (http maps to tcp). */
export type MeshcoreRfTransportType = 'ble' | 'serial' | 'tcp';

/** RF session lifecycle API registered by the MeshCore runtime mount ([#375]/[#377]). */
export interface MeshcoreSessionApi {
  /**
   * Full manual RF connect (Connection panel). Owns prepare → open → attach → success latch
   * (session params + TCP burst-complete deferred reconnect). Prefer this over assembling
   * prepareRfConnect / attachRfSession in UI hooks.
   */
  connect: (
    type: MeshcoreRfTransportType,
    httpAddress?: string,
    blePeripheralId?: string,
  ) => Promise<void>;
  prepareRfConnect: (type: MeshcoreRfTransportType) => Promise<void>;
  attachRfSession: (driverIdentityId: string, type: MeshcoreRfTransportType) => Promise<void>;
  handleRfConnectFailure: (
    type: MeshcoreRfTransportType,
    driverIdentityId?: string,
  ) => Promise<void>;
  finalizeDriverDisconnect: (opts?: { disconnectDriver?: boolean }) => Promise<void>;
  connectAutomatic: (
    type: 'ble' | 'serial' | 'http',
    httpAddress?: string,
    lastSerialPortId?: string | null,
  ) => Promise<void>;
  /** RF contact pubkey for DM send when nodeStore has not been hydrated yet. */
  getDestinationPubKey?: (nodeId: number) => Uint8Array | undefined;
}

let activeSession: MeshcoreSessionApi | null = null;

export function registerMeshcoreSession(api: MeshcoreSessionApi | null): void {
  activeSession = api;
}

export function getMeshcoreSession(): MeshcoreSessionApi {
  if (!activeSession) {
    throw new Error('[meshcoreSession] MeshCore runtime is not mounted');
  }
  return activeSession;
}

export function tryGetMeshcoreSession(): MeshcoreSessionApi | null {
  return activeSession;
}
