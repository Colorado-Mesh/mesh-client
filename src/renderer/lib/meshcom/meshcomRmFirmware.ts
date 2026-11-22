/**
 * Detect MeshCom RM / kocel fork firmware from FWVER strings (e.g. `4.40a-rm5`).
 */

export type MeshcomFirmwareKind = 'rm' | 'stock' | 'unknown';

/** True when `fwver` looks like MeshCom RM (kocel) — revision contains `-rm` + digits. */
export function isMeshcomRmFirmware(fwver: string | null | undefined): boolean {
  return classifyMeshcomFirmware(fwver) === 'rm';
}

/**
 * Classify firmware revision for RM-only command gating.
 * Empty / missing → `unknown` (do not treat as stock; allow send with a UI hint).
 */
export function classifyMeshcomFirmware(fwver: string | null | undefined): MeshcomFirmwareKind {
  const raw = typeof fwver === 'string' ? fwver.trim() : '';
  if (!raw) return 'unknown';
  if (/-rm\d*\b/i.test(raw)) return 'rm';
  return 'stock';
}

/** Leading `--token` from a console / catalog command line (lowercase, no args). */
export function meshcomCommandLeadingToken(command: string): string {
  const trimmed = command.trim();
  const match = /^--([a-z0-9-]+)/i.exec(trimmed);
  return match ? `--${match[1].toLowerCase()}` : '';
}

/** True when the command line targets an RM-only catalog token. */
export function isMeshcomRmOnlyCommandLine(
  command: string,
  rmOnlyTokens: ReadonlySet<string>,
): boolean {
  const token = meshcomCommandLeadingToken(command);
  if (!token) return false;
  // Multi-word tokens like `--batt factor` are not RM-gated here; match exact catalog tokens.
  return rmOnlyTokens.has(token);
}
