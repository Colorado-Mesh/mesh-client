import type { ConnectionType } from '../types';

/** RF session lifecycle API registered by the Meshtastic runtime mount ([#375]/[#377]). */
export interface MeshtasticSessionApi {
  prepareRfConnect: (
    type: ConnectionType,
    httpAddress?: string,
    blePeripheralId?: string,
  ) => Promise<void>;
  attachRfSession: (driverIdentityId: string, type: ConnectionType) => Promise<void>;
  handleRfConnectFailure: () => Promise<void>;
  finalizeDriverDisconnect: (opts?: { disconnectDriver?: boolean }) => Promise<void>;
  connectAutomatic: (
    type: ConnectionType,
    httpAddress?: string,
    lastSerialPortId?: string | null,
    blePeripheralId?: string,
  ) => Promise<void>;
}

let activeSession: MeshtasticSessionApi | null = null;

export function registerMeshtasticSession(api: MeshtasticSessionApi | null): void {
  activeSession = api;
}

export function getMeshtasticSession(): MeshtasticSessionApi {
  if (!activeSession) {
    throw new Error('[meshtasticSession] Meshtastic runtime is not mounted');
  }
  return activeSession;
}

export function tryGetMeshtasticSession(): MeshtasticSessionApi | null {
  return activeSession;
}
