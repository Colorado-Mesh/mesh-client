import { useBlockStore } from '@/renderer/stores/blockStore';
import { bytesToHex } from '@/shared/hexBytes';

import { getMeshcorePubKey } from './meshcore/meshcorePubKeyRegistry';

/**
 * `blocked_contacts.identity_id` for Meshtastic / MeshCore. Node blocks follow the sender, not the
 * radio we happen to be connected through, and LoRa identity ids change across connects, so both
 * protocols use one stable scope (the `protocol` column keeps them apart).
 */
export const LORA_BLOCKLIST_SCOPE_ID = 'lora-blocklist';

/** Protocols whose blocklist is keyed by node id / pubkey and filtered at `PacketRouter`. */
export function isLoraBlocklistProtocol(protocol: string): protocol is 'meshtastic' | 'meshcore' {
  return protocol === 'meshtastic' || protocol === 'meshcore';
}

/**
 * True when `from` is fully blocked on a LoRa protocol. Meshtastic matches the decimal node id;
 * MeshCore also matches the sender's registered 32-byte pubkey (what Node Detail stores).
 * Channel senders known only by a display-name stub have no pubkey and cannot match.
 */
export function isLoraSenderBlocked(protocol: string, from: number): boolean {
  if (!isLoraBlocklistProtocol(protocol) || !Number.isFinite(from) || from <= 0) return false;
  const store = useBlockStore.getState();
  if (store.byProtocol[protocol] == null) return false;
  if (store.isBlocked(String(from), protocol)) return true;
  if (protocol === 'meshcore') {
    const pubKey = getMeshcorePubKey(from);
    if (pubKey) return store.isBlocked(bytesToHex(pubKey), protocol);
  }
  return false;
}

/** Load the Meshtastic + MeshCore blocklists (App mount). Failures log inside `blockStore.load`. */
export async function hydrateLoraBlocklists(): Promise<void> {
  await Promise.all([
    useBlockStore.getState().load('meshtastic', LORA_BLOCKLIST_SCOPE_ID),
    useBlockStore.getState().load('meshcore', LORA_BLOCKLIST_SCOPE_ID),
  ]);
}
