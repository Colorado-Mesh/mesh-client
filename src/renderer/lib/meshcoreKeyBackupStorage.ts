import { createEncryptedKeyBackupStorage } from './encryptedKeyBackupStorage';
import { nodeNumDisplayHex } from './keyBackupBytes';
import { MESHCORE_PUBLIC_KEY_LENGTH } from './letsMeshJwt';

export const MESHCORE_KEY_BACKUP_PREFIX = 'mesh-client:meshcore-key-backup:';
export const MESHCORE_KEY_BACKUP_INDEX_KEY = 'mesh-client:meshcore-key-backup-index';

const MESHCORE_PRIVATE_LENS = [MESHCORE_PUBLIC_KEY_LENGTH, MESHCORE_PUBLIC_KEY_LENGTH * 2] as const;

export interface MeshcoreKeyBackupPayload {
  protocol: 'meshcore';
  nodeId: number;
  publicKey: string;
  privateKey: string;
  nodeLabel?: string;
  backedUpAt: number;
}

export interface MeshcoreKeyBackupIndexEntry {
  nodeId: number;
  nodeLabel?: string;
  publicKeyB64: string;
  backedUpAt: number;
}

function isValidMeshcorePrivateKeyLength(len: number): boolean {
  return MESHCORE_PRIVATE_LENS.some((n) => n === len);
}

function validateMeshcoreKeyPair(publicKey: Uint8Array, privateKey: Uint8Array): void {
  if (publicKey.length !== MESHCORE_PUBLIC_KEY_LENGTH) {
    throw new Error('MeshCore backup: public key must be 32 bytes');
  }
  if (!isValidMeshcorePrivateKeyLength(privateKey.length)) {
    throw new Error('MeshCore backup: private key must be 32 or 64 bytes');
  }
}

const backup = createEncryptedKeyBackupStorage({
  prefix: MESHCORE_KEY_BACKUP_PREFIX,
  indexKey: MESHCORE_KEY_BACKUP_INDEX_KEY,
  protocol: 'meshcore',
  idField: 'nodeId',
  validateKeyPair: validateMeshcoreKeyPair,
});

export function meshcoreKeyBackupStorageKey(nodeId: number): string {
  return backup.storageKey(nodeId);
}

export function listMeshcoreKeyBackups(): MeshcoreKeyBackupIndexEntry[] {
  return backup.list().map((e) => ({
    nodeId: e.id,
    nodeLabel: e.nodeLabel,
    publicKeyB64: e.publicKeyB64,
    backedUpAt: e.backedUpAt,
  }));
}

export function hasMeshcoreKeyBackup(nodeId: number): boolean {
  return backup.has(nodeId);
}

export async function saveMeshcoreKeyBackup(options: {
  nodeId: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  nodeLabel?: string;
}): Promise<void> {
  await backup.save({
    id: options.nodeId,
    publicKey: options.publicKey,
    privateKey: options.privateKey,
    nodeLabel: options.nodeLabel,
  });
}

export async function loadMeshcoreKeyBackup(nodeId: number): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  payload: MeshcoreKeyBackupPayload;
} | null> {
  const loaded = await backup.load(nodeId);
  if (!loaded) return null;
  const { payload } = loaded;
  return {
    publicKey: loaded.publicKey,
    privateKey: loaded.privateKey,
    payload: {
      protocol: 'meshcore',
      nodeId: payload.id,
      publicKey: payload.publicKey,
      privateKey: payload.privateKey,
      nodeLabel: payload.nodeLabel,
      backedUpAt: payload.backedUpAt,
    },
  };
}

export function deleteMeshcoreKeyBackup(nodeId: number): void {
  backup.remove(nodeId);
}

/** Node label / !hex detail for restore picker (protocol prefix applied in UI via i18n). */
export function formatMeshcoreBackupDetail(entry: MeshcoreKeyBackupIndexEntry): string {
  const hex = nodeNumDisplayHex(entry.nodeId);
  const label = entry.nodeLabel?.trim();
  return label ? `${label} (!${hex})` : `!${hex}`;
}
