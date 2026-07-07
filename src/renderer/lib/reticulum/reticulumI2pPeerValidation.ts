/** Max I2P peers string length written to sidecar INI (comma-separated .b32.i2p entries). */
export const RETICULUM_I2P_PEERS_MAX_LENGTH = 512;

const I2P_PEER_ENTRY_RE = /^[a-z2-7]{52}\.b32\.i2p$/i;

/** Validate comma-separated I2P peer hostnames before proxy POST / sidecar write. */
export function validateReticulumI2pPeers(peers: string): string | null {
  const trimmed = peers.trim();
  if (!trimmed) return 'connectionPanel.reticulumInterfaces.i2pPeersRequired';
  if (trimmed.length > RETICULUM_I2P_PEERS_MAX_LENGTH) {
    return 'connectionPanel.reticulumInterfaces.i2pPeersTooLong';
  }
  if (trimmed.includes('\n') || trimmed.includes('\r') || trimmed.includes('\0')) {
    return 'connectionPanel.reticulumInterfaces.i2pPeersInvalid';
  }
  const entries = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return 'connectionPanel.reticulumInterfaces.i2pPeersRequired';
  for (const entry of entries) {
    if (!I2P_PEER_ENTRY_RE.test(entry)) {
      return 'connectionPanel.reticulumInterfaces.i2pPeersInvalid';
    }
  }
  return null;
}
