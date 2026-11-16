import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNodeStore } from '../../stores/nodeStore';
import { meshcoreSyntheticPlaceholderPubKeyHex, pubkeyToNodeId } from '../meshcoreUtils';
import { registerMeshcoreSession } from '../sessions/meshcoreSession';
import type { IdentityId } from '../types';
import {
  hasMeshcoreDestinationPubKey,
  resolveMeshcoreDestinationPubKeyForIdentity,
  resolveMeshcoreDestinationPubKeyHexSync,
  resolveMeshcoreDestinationPubKeySync,
} from './meshcoreDestinationPubKey';
import { clearMeshcorePubKeyRegistry, registerMeshcorePubKey } from './meshcorePubKeyRegistry';

/** Little-endian first word = nodeId; remaining zeros → pubkeyToNodeId === nodeId. */
function keyForNodeId(nodeId: number): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = nodeId & 0xff;
  b[1] = (nodeId >>> 8) & 0xff;
  b[2] = (nodeId >>> 16) & 0xff;
  b[3] = (nodeId >>> 24) & 0xff;
  return b;
}

function keyHex(nodeId: number): string {
  return Array.from(keyForNodeId(nodeId), (x) => x.toString(16).padStart(2, '0')).join('');
}

const PEER_NODE_ID = 0xabc123;
const PEER_PUBKEY = keyForNodeId(PEER_NODE_ID);
const PEER_HEX = keyHex(PEER_NODE_ID);
const IDENTITY = 'meshcore:test' as IdentityId;

describe('resolveMeshcoreDestinationPubKeySync', () => {
  beforeEach(() => {
    clearMeshcorePubKeyRegistry();
    registerMeshcoreSession(null);
    useNodeStore.setState({ nodes: {} });
    expect(pubkeyToNodeId(PEER_PUBKEY)).toBe(PEER_NODE_ID);
  });

  it('returns store publicKey bytes when they hash to nodeId', () => {
    expect(
      resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID, { storePublicKey: PEER_PUBKEY }),
    ).toEqual(PEER_PUBKEY);
  });

  it('returns store publicKeyHex when bytes are missing', () => {
    expect(
      resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID, { storePublicKeyHex: PEER_HEX }),
    ).toEqual(PEER_PUBKEY);
  });

  it('returns MeshNode public_key_hex when store is empty', () => {
    expect(
      resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID, { meshNodePublicKeyHex: PEER_HEX }),
    ).toEqual(PEER_PUBKEY);
  });

  it('falls back to the global registry', () => {
    registerMeshcorePubKey(PEER_NODE_ID, PEER_PUBKEY);
    expect(resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID)).toEqual(PEER_PUBKEY);
  });

  it('falls back to the session getDestinationPubKey map', () => {
    registerMeshcoreSession({
      connect: vi.fn(),
      prepareRfConnect: vi.fn(),
      attachRfSession: vi.fn(),
      handleRfConnectFailure: vi.fn(),
      finalizeDriverDisconnect: vi.fn(),
      connectAutomatic: vi.fn(),
      getDestinationPubKey: (nodeId) => (nodeId === PEER_NODE_ID ? PEER_PUBKEY : undefined),
    });
    expect(resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID)).toEqual(PEER_PUBKEY);
  });

  it('rejects synthetic placeholder hex', () => {
    const synth = meshcoreSyntheticPlaceholderPubKeyHex(PEER_NODE_ID);
    expect(
      resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID, { meshNodePublicKeyHex: synth }),
    ).toBeUndefined();
  });

  it('rejects keys that do not hash to nodeId', () => {
    const mismatched = new Uint8Array(32).fill(0xab);
    expect(pubkeyToNodeId(mismatched)).not.toBe(PEER_NODE_ID);
    expect(
      resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID, { storePublicKey: mismatched }),
    ).toBeUndefined();
  });

  it('returns undefined for missing sources', () => {
    expect(resolveMeshcoreDestinationPubKeySync(PEER_NODE_ID)).toBeUndefined();
  });

  it('resolveMeshcoreDestinationPubKeyHexSync returns lowercase hex', () => {
    expect(
      resolveMeshcoreDestinationPubKeyHexSync(PEER_NODE_ID, { storePublicKeyHex: PEER_HEX }),
    ).toBe(PEER_HEX);
  });
});

describe('resolveMeshcoreDestinationPubKeyForIdentity', () => {
  beforeEach(() => {
    clearMeshcorePubKeyRegistry();
    registerMeshcoreSession(null);
    useNodeStore.setState({ nodes: {} });
  });

  it('reads publicKeyHex from the identity node store', () => {
    useNodeStore.setState({
      nodes: {
        [IDENTITY]: {
          [PEER_NODE_ID]: {
            nodeId: PEER_NODE_ID,
            publicKeyHex: PEER_HEX,
          },
        },
      },
    });
    expect(resolveMeshcoreDestinationPubKeyForIdentity(IDENTITY, PEER_NODE_ID)).toEqual(
      PEER_PUBKEY,
    );
    expect(hasMeshcoreDestinationPubKey(IDENTITY, PEER_NODE_ID)).toBe(true);
  });

  it('returns false/undefined when the store has no key', () => {
    expect(hasMeshcoreDestinationPubKey(IDENTITY, PEER_NODE_ID)).toBe(false);
    expect(resolveMeshcoreDestinationPubKeyForIdentity(IDENTITY, PEER_NODE_ID)).toBeUndefined();
  });
});
