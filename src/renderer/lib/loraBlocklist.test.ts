import { afterEach, describe, expect, it } from 'vitest';

import { useBlockStore } from '@/renderer/stores/blockStore';
import { bytesToHex } from '@/shared/hexBytes';

import { isLoraSenderBlocked, LORA_BLOCKLIST_SCOPE_ID } from './loraBlocklist';
import { registerMeshcorePubKey } from './meshcore/meshcorePubKeyRegistry';

function setBlocked(protocol: 'meshtastic' | 'meshcore' | 'reticulum', hashes: string[]): void {
  useBlockStore.setState({
    byProtocol: {
      [protocol]: {
        identityId: LORA_BLOCKLIST_SCOPE_ID,
        hashes: new Set(hashes),
        entries: [],
        loaded: true,
      },
    },
  });
}

describe('isLoraSenderBlocked', () => {
  afterEach(() => {
    useBlockStore.setState({ byProtocol: {} });
  });

  it('matches Meshtastic senders by decimal node id', () => {
    setBlocked('meshtastic', ['305419896']);
    expect(isLoraSenderBlocked('meshtastic', 0x12345678)).toBe(true);
    expect(isLoraSenderBlocked('meshtastic', 0x12345679)).toBe(false);
  });

  it('matches MeshCore senders by their registered pubkey', () => {
    const pubKey = new Uint8Array(32).map((_, i) => i + 1);
    const nodeId = 0x0a0b0c0d;
    registerMeshcorePubKey(nodeId, pubKey);
    setBlocked('meshcore', [bytesToHex(pubKey)]);
    expect(isLoraSenderBlocked('meshcore', nodeId)).toBe(true);
    expect(isLoraSenderBlocked('meshcore', nodeId + 1)).toBe(false);
  });

  it('never blocks Reticulum, unknown protocols, or unknown senders here', () => {
    setBlocked('reticulum', ['5']);
    expect(isLoraSenderBlocked('reticulum', 5)).toBe(false);
    expect(isLoraSenderBlocked('zigbee', 5)).toBe(false);
    setBlocked('meshtastic', ['0']);
    expect(isLoraSenderBlocked('meshtastic', 0)).toBe(false);
  });

  it('allows everything before the blocklist is hydrated', () => {
    expect(isLoraSenderBlocked('meshtastic', 77)).toBe(false);
  });
});
