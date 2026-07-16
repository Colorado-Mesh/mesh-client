import { createEncryptedKeyBackupStorage } from './encryptedKeyBackupStorage';
import { errLikeToLogString } from './errLikeToLogString';
import { nodeNumDisplayHex } from './keyBackupBytes';

export const LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY = 'mesh-client:key-backup';
export const MESHTASTIC_DM_KEY_BACKUP_PREFIX = 'mesh-client:meshtastic-dm-key-backup:';
export const MESHTASTIC_DM_KEY_BACKUP_INDEX_KEY = 'mesh-client:meshtastic-dm-key-backup-index';

const MESHTASTIC_KEY_LEN = 32;

export interface MeshtasticDmKeyBackupPayload {
  protocol: 'meshtastic';
  nodeNum: number;
  publicKey: string;
  privateKey: string;
  nodeLabel?: string;
  backedUpAt: number;
}

export interface MeshtasticDmKeyBackupIndexEntry {
  nodeNum: number;
  nodeLabel?: string;
  publicKeyB64: string;
  backedUpAt: number;
}

function validateMeshtasticKeyPair(publicKey: Uint8Array, privateKey: Uint8Array): void {
  if (publicKey.length !== MESHTASTIC_KEY_LEN) {
    throw new Error('Meshtastic backup: public key must be 32 bytes');
  }
  if (privateKey.length !== MESHTASTIC_KEY_LEN) {
    throw new Error('Meshtastic backup: private key must be 32 bytes');
  }
}

const backup = createEncryptedKeyBackupStorage({
  prefix: MESHTASTIC_DM_KEY_BACKUP_PREFIX,
  indexKey: MESHTASTIC_DM_KEY_BACKUP_INDEX_KEY,
  protocol: 'meshtastic',
  idField: 'nodeNum',
  validateKeyPair: validateMeshtasticKeyPair,
});

export function meshtasticDmKeyBackupStorageKey(nodeNum: number): string {
  return backup.storageKey(nodeNum);
}

/** Decrypt per-node slots and rewrite the index (missing or corrupt index). */
export async function rebuildMeshtasticDmKeyBackupIndex(): Promise<
  MeshtasticDmKeyBackupIndexEntry[]
> {
  const entries = await backup.rebuildIndexFromSlots();
  return entries.map((e) => ({
    nodeNum: e.id,
    nodeLabel: e.nodeLabel,
    publicKeyB64: e.publicKeyB64,
    backedUpAt: e.backedUpAt,
  }));
}

/** Rebuild index from encrypted slots when missing, corrupt, or out of sync. */
export async function ensureMeshtasticDmKeyBackupIndex(): Promise<void> {
  await backup.ensureIndex();
}

export function listMeshtasticDmKeyBackups(): MeshtasticDmKeyBackupIndexEntry[] {
  return backup.list().map((e) => ({
    nodeNum: e.id,
    nodeLabel: e.nodeLabel,
    publicKeyB64: e.publicKeyB64,
    backedUpAt: e.backedUpAt,
  }));
}

export function hasMeshtasticDmKeyBackup(nodeNum: number): boolean {
  return backup.has(nodeNum);
}

export async function saveMeshtasticDmKeyBackup(options: {
  nodeNum: number;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  nodeLabel?: string;
}): Promise<void> {
  await backup.save({
    id: options.nodeNum,
    publicKey: options.publicKey,
    privateKey: options.privateKey,
    nodeLabel: options.nodeLabel,
  });
}

export async function loadMeshtasticDmKeyBackup(nodeNum: number): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  payload: MeshtasticDmKeyBackupPayload;
} | null> {
  const loaded = await backup.load(nodeNum);
  if (!loaded) return null;
  const { payload } = loaded;
  return {
    publicKey: loaded.publicKey,
    privateKey: loaded.privateKey,
    payload: {
      protocol: 'meshtastic',
      nodeNum: payload.id,
      publicKey: payload.publicKey,
      privateKey: payload.privateKey,
      nodeLabel: payload.nodeLabel,
      backedUpAt: payload.backedUpAt,
    },
  };
}

export function deleteMeshtasticDmKeyBackup(nodeNum: number): void {
  backup.remove(nodeNum);
}

/** Migrate legacy single-slot backup when it contains a valid pair. */
export async function migrateLegacyMeshtasticDmKeyBackup(nodeNum: number): Promise<boolean> {
  try {
    return await backup.migrateLegacySingleSlot(LEGACY_MESHTASTIC_DM_KEY_BACKUP_KEY, nodeNum);
  } catch (err) {
    console.warn('[meshtasticDmKeyBackupStorage] legacy migrate failed ' + errLikeToLogString(err));
    return false;
  }
}

export function formatMeshtasticBackupDetail(entry: MeshtasticDmKeyBackupIndexEntry): string {
  const hex = nodeNumDisplayHex(entry.nodeNum);
  const label = entry.nodeLabel?.trim();
  return label ? `${label} (!${hex})` : `!${hex}`;
}
