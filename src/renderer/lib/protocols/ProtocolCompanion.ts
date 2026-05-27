import type { ContactRecord } from './Protocol';

/**
 * Optional companion-radio operations outside the core {@link Protocol} contract.
 * MeshCore implements this; Meshtastic panels use the core Protocol surface only ([#377]).
 */
export interface ProtocolCompanion {
  sendAdvert(handle: unknown): Promise<void>;
  syncClock(handle: unknown): Promise<void>;
  refreshContacts(handle: unknown): Promise<ContactRecord[]>;
  removeContact(handle: unknown, pubKey: Uint8Array): Promise<void>;
  exportContact(handle: unknown, pubKey: Uint8Array): Promise<Uint8Array | null>;
  shareContact(handle: unknown, pubKey: Uint8Array): Promise<void>;
  importContact(handle: unknown, advertBytes: Uint8Array): Promise<void>;
  signData(handle: unknown, data: Uint8Array): Promise<Uint8Array>;
  exportPrivateKey(handle: unknown): Promise<Uint8Array>;
  importPrivateKey(handle: unknown, privateKey: Uint8Array): Promise<void>;
}

export function asProtocolCompanion(protocol: { type: string }): ProtocolCompanion | null {
  if (protocol.type !== 'meshcore') return null;
  return protocol as unknown as ProtocolCompanion;
}
