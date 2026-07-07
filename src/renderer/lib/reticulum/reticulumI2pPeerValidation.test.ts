import { describe, expect, it } from 'vitest';

import {
  RETICULUM_I2P_PEERS_MAX_LENGTH,
  validateReticulumI2pPeers,
} from './reticulumI2pPeerValidation';

const VALID_PEER = `${'a'.repeat(52)}.b32.i2p`;

describe('validateReticulumI2pPeers', () => {
  it('accepts a single valid .b32.i2p peer', () => {
    expect(validateReticulumI2pPeers(VALID_PEER)).toBeNull();
  });

  it('accepts comma-separated valid peers with surrounding whitespace', () => {
    expect(validateReticulumI2pPeers(` ${VALID_PEER}, ${VALID_PEER} `)).toBeNull();
  });

  it('rejects empty input', () => {
    expect(validateReticulumI2pPeers('')).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersRequired',
    );
    expect(validateReticulumI2pPeers('   ')).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersRequired',
    );
  });

  it('rejects peers longer than RETICULUM_I2P_PEERS_MAX_LENGTH', () => {
    const tooLong = `${VALID_PEER},${'a'.repeat(RETICULUM_I2P_PEERS_MAX_LENGTH)}`;
    expect(tooLong.length).toBeGreaterThan(RETICULUM_I2P_PEERS_MAX_LENGTH);
    expect(validateReticulumI2pPeers(tooLong)).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersTooLong',
    );
  });

  it('rejects newline, carriage return, and null bytes', () => {
    expect(validateReticulumI2pPeers(`${VALID_PEER.slice(0, 26)}\n${VALID_PEER.slice(26)}`)).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
    expect(validateReticulumI2pPeers(`${VALID_PEER.slice(0, 26)}\r${VALID_PEER.slice(26)}`)).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
    expect(validateReticulumI2pPeers(`${VALID_PEER}\u0000`)).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
  });

  it('rejects invalid hostname format', () => {
    expect(validateReticulumI2pPeers('not-a-peer.example.com')).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
    expect(validateReticulumI2pPeers('tooshort.b32.i2p')).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
    expect(validateReticulumI2pPeers(`${VALID_PEER},bad-peer`)).toBe(
      'connectionPanel.reticulumInterfaces.i2pPeersInvalid',
    );
  });
});
