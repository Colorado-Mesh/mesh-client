import type { ConnectionType } from '../types';

/** RF session lifecycle API registered by the Meshtastic runtime mount ([#375]/[#377]). */
export interface MeshtasticSessionApi {
  prepareRfConnect: (
    type: ConnectionType,
    httpAddress?: string,
    blePeripheralId?: string,
    lastSerialPortId?: string | null,
  ) => Promise<void>;
  attachRfSession: (driverIdentityId: string, type: ConnectionType) => Promise<void>;
  handleRfConnectFailure: (driverIdentityId?: string) => Promise<void>;
  finalizeDriverDisconnect: (opts?: { disconnectDriver?: boolean }) => Promise<void>;
  /** Meshtastic chat send (RF and MQTT-only via TransportManager). */
  sendChatMessage: (
    text: string,
    channelIndex: number,
    destination?: number,
    replyId?: number,
  ) => void;
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

/** Maps TransportManager tempId → current messageStore row id (survives PacketRouter echo re-key). */
const outboundStoreKeyByTempId = new Map<number, string>();

export function trackMeshtasticOutboundTempId(tempId: number, storeKey: string): void {
  outboundStoreKeyByTempId.set(tempId >>> 0, storeKey);
}

export function retargetMeshtasticOutboundTempId(tempId: number, newStoreKey: string): void {
  const key = tempId >>> 0;
  if (outboundStoreKeyByTempId.has(key)) {
    outboundStoreKeyByTempId.set(key, newStoreKey);
  }
}

export function resolveMeshtasticOutboundStoreKey(tempId: number, fallback: string): string {
  return outboundStoreKeyByTempId.get(tempId >>> 0) ?? fallback;
}

export function clearMeshtasticOutboundTempId(tempId: number): void {
  outboundStoreKeyByTempId.delete(tempId >>> 0);
}
