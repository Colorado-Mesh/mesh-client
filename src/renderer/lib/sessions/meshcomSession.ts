/** MeshCom RF / EXTUDP / KISS transport types for session attach. */
export type MeshcomRfTransportType = 'ble' | 'serial' | 'tcp' | 'udp' | 'http';

/** RF session lifecycle API registered by the MeshCom runtime mount. */
export interface MeshcomSessionApi {
  /**
   * Full manual connect (Connection panel). Opens transport via
   * `openMeshComTransport` / ConnectionDriver, then latches reconnect params.
   */
  connect: (
    type: MeshcomRfTransportType,
    httpAddress?: string,
    blePeripheralId?: string,
  ) => Promise<void>;
  prepareRfConnect: (type: MeshcomRfTransportType) => Promise<void>;
  attachRfSession: (driverIdentityId: string, type: MeshcomRfTransportType) => Promise<void>;
  handleRfConnectFailure: (
    type: MeshcomRfTransportType,
    driverIdentityId?: string,
  ) => Promise<void>;
  finalizeDriverDisconnect: (opts?: { disconnectDriver?: boolean }) => Promise<void>;
  latchExplicitDisconnect?: () => boolean;
  clearExplicitDisconnectLatch?: () => void;
  connectAutomatic: (
    type: 'ble' | 'serial' | 'http' | 'udp' | 'tcp',
    httpAddress?: string,
    lastSerialPortId?: string | null,
    blePeripheralId?: string,
  ) => Promise<void>;
}

let activeSession: MeshcomSessionApi | null = null;

export function registerMeshcomSession(api: MeshcomSessionApi | null): void {
  activeSession = api;
}

export function getMeshcomSession(): MeshcomSessionApi {
  if (!activeSession) {
    throw new Error('[meshcomSession] MeshCom runtime is not mounted');
  }
  return activeSession;
}

export function tryGetMeshcomSession(): MeshcomSessionApi | null {
  return activeSession;
}
