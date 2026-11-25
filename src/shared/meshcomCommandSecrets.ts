/**
 * MeshCom device-command secrets shared by the renderer log redactor and support-bundle
 * scrubber so the two cannot drift apart.
 *
 * Covered: WiFi `--setpwd`, web UI `--webpwd`, BLE `--btcode`, KISS/NET Console `--passwd`.
 */

export const MESHCOM_COMMAND_REDACTED = '[redacted]';

/** Leading tokens whose following argument must never appear in logs or support bundles. */
export const MESHCOM_SENSITIVE_COMMAND_TOKENS = [
  '--setpwd',
  '--webpwd',
  '--btcode',
  '--passwd',
] as const;

export function isMeshcomSensitiveCommandLine(command: string): boolean {
  const lower = command.trim().toLowerCase();
  return MESHCOM_SENSITIVE_COMMAND_TOKENS.some((token) => lower.startsWith(token));
}

/** Redact the argument of a single MeshCom `--` command line for logs / console display. */
export function redactMeshcomCommandArgForLog(command: string): string {
  const trimmed = command.trim();
  if (!isMeshcomSensitiveCommandLine(trimmed)) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  return `${parts[0]} ${MESHCOM_COMMAND_REDACTED}`;
}

/**
 * Scrub sensitive MeshCom `--` args from free text (support-bundle logs).
 * The renderer already redacts before logging; this catches older builds' lines.
 */
export function redactMeshcomSecretsInText(text: string): string {
  return text.replace(
    /(--(?:setpwd|webpwd|btcode|passwd))(\s+)(?!\[redacted\])\S+/gi,
    `$1$2${MESHCOM_COMMAND_REDACTED}`,
  );
}
