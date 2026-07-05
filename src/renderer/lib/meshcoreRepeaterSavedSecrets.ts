import {
  getMeshcoreRepeaterCredential,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';
import {
  clearMeshcoreRepeaterEphemeralPassword,
  setMeshcoreRepeaterEphemeralPassword,
} from './meshcoreRepeaterSession';

export interface MeshcoreRepeaterSavedSecretsSummary {
  hasCredential: boolean;
}

export function getMeshcoreRepeaterSavedSecretsSummary(
  nodeId: number,
): MeshcoreRepeaterSavedSecretsSummary {
  const cred = getMeshcoreRepeaterCredential(nodeId);
  return {
    hasCredential: cred != null,
  };
}

/** Clears saved password and ephemeral session password for a repeater. */
export async function forgetMeshcoreRepeaterSavedSecret(nodeId: number): Promise<void> {
  await setMeshcoreRepeaterCredential(nodeId, null);
  clearMeshcoreRepeaterEphemeralPassword(nodeId);
}

/** Keeps saved password but clears ephemeral session-only password. */
export function clearMeshcoreRepeaterEphemeralSecret(nodeId: number): void {
  clearMeshcoreRepeaterEphemeralPassword(nodeId);
}

/** Stores ephemeral session password without persisting. */
export function setMeshcoreRepeaterEphemeralSecret(nodeId: number, password: string): void {
  setMeshcoreRepeaterEphemeralPassword(nodeId, password);
}
