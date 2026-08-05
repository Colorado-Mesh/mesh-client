/**
 * Allowed `received_via` / `sent_via` atoms for Reticulum LXMF rows (SQLite + IPC).
 * Keep in sync with renderer classification and sidecar wire labels.
 */

/** Single-value atoms accepted by `db:saveReticulumMessage` / rehydrate. */
export const RETICULUM_SINGLE_VIA_ATOMS = [
  'rf',
  'ble',
  'tcp',
  'network',
  'mqtt',
  'both',
  'paper',
] as const;

export type ReticulumSingleViaAtom = (typeof RETICULUM_SINGLE_VIA_ATOMS)[number];

/** Atoms that may appear in explicit `+`-joined multi-egress labels (e.g. `rf+tcp`). */
export const RETICULUM_MULTI_VIA_ATOMS = ['ble', 'rf', 'tcp', 'network'] as const;

const SINGLE = new Set<string>(RETICULUM_SINGLE_VIA_ATOMS);
const MULTI = new Set<string>(RETICULUM_MULTI_VIA_ATOMS);

/** Single atom or explicit `+`-joined multi-egress (e.g. `rf+tcp`). */
export function isAllowedReticulumReceivedVia(value: string): boolean {
  if (SINGLE.has(value)) return true;
  const parts = value.split('+');
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => MULTI.has(p));
}
