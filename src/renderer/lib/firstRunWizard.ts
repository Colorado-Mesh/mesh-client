import { type MeshProtocol, REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { enabledProtocolsFrom } from './enabledProtocols';

/**
 * First-run wizard progress, persisted in `mesh-client:firstRunWizard`.
 * - `unseen`: never shown (existing installs stay here forever).
 * - `pending`: shown on a fresh install but not finished; shows again next launch.
 * - `done`: finished or skipped; never shown again.
 */
export type FirstRunStatus = 'unseen' | 'pending' | 'done';

export const FIRST_RUN_WIZARD_STORAGE_KEY = 'mesh-client:firstRunWizard';

/**
 * The picker opens on a fresh install (the database was created this launch) and keeps
 * opening until the person finishes or skips it. Only a literal `true` from the database
 * counts, so a missing or mocked bridge never opens it.
 */
export function shouldOpenFirstRunPicker(
  status: FirstRunStatus,
  databaseCreatedThisLaunch: unknown,
): boolean {
  if (status === 'pending') return true;
  return status === 'unseen' && databaseCreatedThisLaunch === true;
}

/** Protocols to hide for a pick, or `null` when nothing was picked (one must stay on). */
export function hiddenProtocolsForSelection(
  selected: readonly MeshProtocol[],
): MeshProtocol[] | null {
  if (!REGISTERED_MESH_PROTOCOLS.some((p) => selected.includes(p))) return null;
  return REGISTERED_MESH_PROTOCOLS.filter((p) => !selected.includes(p));
}

/** Tour order: the picked protocols in registry order. */
export function tourProtocolsForSelection(selected: readonly MeshProtocol[]): MeshProtocol[] {
  return REGISTERED_MESH_PROTOCOLS.filter((p) => selected.includes(p));
}

/** Pre-checked boxes: the protocols a fresh install enables by default. */
export function defaultFirstRunSelection(): MeshProtocol[] {
  return enabledProtocolsFrom(DEFAULT_APP_SETTINGS_SHARED.hiddenProtocols);
}
