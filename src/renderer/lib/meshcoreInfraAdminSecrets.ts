import {
  getMeshcoreRepeaterCredential,
  listMeshcoreRepeaterCredentialNodeIds,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';
import {
  clearMeshcoreRepeaterEphemeralSecret,
  forgetMeshcoreRepeaterSavedSecret,
  setMeshcoreRepeaterEphemeralSecret,
} from './meshcoreRepeaterSavedSecrets';
import { meshcoreRepeaterHasResolvablePassword } from './meshcoreRepeaterSession';
import {
  getMeshcoreRoomCredential,
  listMeshcoreRoomCredentialNodeIds,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';

export type MeshcoreInfraNodeKind = 'Repeater' | 'Room';

export interface MeshcoreInfraAdminPasswordEntry {
  nodeId: number;
  kind: MeshcoreInfraNodeKind;
}

/** Session-only room admin passwords (ops Continue without Remember). */
const roomEphemeralAdminPasswords = new Map<number, string>();

function isRoomHwModel(hwModel: string | undefined): boolean {
  return hwModel === 'Room';
}

function setRoomEphemeralAdminPassword(nodeId: number, password: string): void {
  const trimmed = password.trim();
  if (!trimmed) {
    roomEphemeralAdminPasswords.delete(nodeId >>> 0);
    return;
  }
  roomEphemeralAdminPasswords.set(nodeId >>> 0, trimmed);
}

function clearRoomEphemeralAdminPassword(nodeId: number): void {
  roomEphemeralAdminPasswords.delete(nodeId >>> 0);
}

/** Clears all session-only room admin passwords (tests / logout). */
export function clearAllRoomEphemeralAdminPasswords(): void {
  roomEphemeralAdminPasswords.clear();
}

/** True when a persisted or session admin password can satisfy infra login. */
export function hasResolvableAdminPassword(nodeId: number, hwModel: string | undefined): boolean {
  if (isRoomHwModel(hwModel)) {
    if (roomEphemeralAdminPasswords.get(nodeId >>> 0)?.trim()) return true;
    const cred = getMeshcoreRoomCredential(nodeId);
    return !!cred?.adminPassword?.trim();
  }
  return meshcoreRepeaterHasResolvablePassword(nodeId);
}

/**
 * Set admin password for ops (Status/CLI/etc.).
 * Repeater: ephemeral always when non-empty; persist when `persist` is true.
 * Room: session ephemeral always when non-empty; patch persisted `adminPassword` when `persist`.
 */
export async function setAdminPassword(
  nodeId: number,
  hwModel: string | undefined,
  password: string,
  opts?: { persist?: boolean },
): Promise<void> {
  const trimmed = password.trim();
  const persist = opts?.persist === true;

  if (isRoomHwModel(hwModel)) {
    if (!trimmed) return;
    setRoomEphemeralAdminPassword(nodeId, trimmed);
    if (!persist) return;
    const prev = getMeshcoreRoomCredential(nodeId);
    await setMeshcoreRoomCredential(nodeId, {
      guestPassword: prev?.guestPassword ?? '',
      adminPassword: trimmed,
    });
    return;
  }

  if (trimmed) {
    setMeshcoreRepeaterEphemeralSecret(nodeId, trimmed);
  }
  if (trimmed && persist) {
    await setMeshcoreRepeaterCredential(nodeId, { password: trimmed });
  }
}

/**
 * Forget ops admin password.
 * Repeater: clear persisted + ephemeral.
 * Room: clear ephemeral + `adminPassword` only (guest + sync/auto-login unchanged).
 */
export async function forgetAdminPassword(
  nodeId: number,
  hwModel: string | undefined,
): Promise<void> {
  if (isRoomHwModel(hwModel)) {
    clearRoomEphemeralAdminPassword(nodeId);
    const prev = getMeshcoreRoomCredential(nodeId);
    if (!prev) return;
    // Keep an explicit guestPassword (including remembered blank); only drop the whole
    // record when there is no guest field left after clearing admin.
    if (Object.prototype.hasOwnProperty.call(prev, 'guestPassword')) {
      await setMeshcoreRoomCredential(nodeId, { guestPassword: prev.guestPassword ?? '' });
      return;
    }
    await setMeshcoreRoomCredential(nodeId, null);
    return;
  }
  await forgetMeshcoreRepeaterSavedSecret(nodeId);
  clearMeshcoreRepeaterEphemeralSecret(nodeId);
}

/** List nodes with a saved admin password (repeaters + rooms with adminPassword). */
export function listSavedAdminPasswords(): MeshcoreInfraAdminPasswordEntry[] {
  const out: MeshcoreInfraAdminPasswordEntry[] = [];
  for (const nodeId of listMeshcoreRepeaterCredentialNodeIds()) {
    if (getMeshcoreRepeaterCredential(nodeId)?.password.trim()) {
      out.push({ nodeId, kind: 'Repeater' });
    }
  }
  for (const nodeId of listMeshcoreRoomCredentialNodeIds()) {
    const cred = getMeshcoreRoomCredential(nodeId);
    if (cred?.adminPassword?.trim()) {
      out.push({ nodeId, kind: 'Room' });
    }
  }
  return out.sort((a, b) => a.nodeId - b.nodeId);
}

/**
 * Resolve room admin password: live session → ephemeral ops → persisted credential.
 */
export function resolveRoomAdminPassword(nodeId: number, sessionAdmin?: string): string {
  const fromSession = sessionAdmin?.trim() ?? '';
  if (fromSession) return fromSession;
  const ephemeral = roomEphemeralAdminPasswords.get(nodeId >>> 0)?.trim() ?? '';
  if (ephemeral) return ephemeral;
  return getMeshcoreRoomCredential(nodeId)?.adminPassword?.trim() ?? '';
}
