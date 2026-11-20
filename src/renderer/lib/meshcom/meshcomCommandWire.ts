/**
 * Lightweight MeshCom command helpers safe for App-mounted runtime imports.
 * Keep the full ICSSW catalog in `meshcomCommands.ts` (lazy Radio panel only).
 */

/** Official APP shortcut words → equivalent `--` command. */
export const MESHCOM_APP_SHORTCUTS: Readonly<Record<string, string>> = {
  GATEWAY: '--gateway',
  GPS: '--gps',
  BUTTON: '--button',
  TRACK: '--track',
  BME: '--bme on',
  BMP: '--bmp on',
  'WX-Info': '--wx',
  WX: '--wx',
};

/**
 * Format UTC wall time for `--settime yyyy.mm.dd hh:mm:ss`.
 */
export function formatMeshcomSettimeUtc(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}.${mo}.${d} ${h}:${mi}:${s}`;
}

export function buildMeshcomSettimeCommand(date?: Date): string {
  return `--settime ${formatMeshcomSettimeUtc(date)}`;
}

/**
 * Normalize user/console input into a firmware command line.
 * Accepts APP shortcuts (GATEWAY, WX-Info) and `--` commands.
 */
export function normalizeMeshcomCommandInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const shortcut = MESHCOM_APP_SHORTCUTS[trimmed] ?? MESHCOM_APP_SHORTCUTS[trimmed.toUpperCase()];
  if (shortcut) return shortcut;
  if (trimmed.startsWith('--')) return trimmed;
  return `--${trimmed}`;
}

export function isMeshcomSensitiveCommand(command: string): boolean {
  const lower = command.trim().toLowerCase();
  return (
    lower.startsWith('--setpwd') || lower.startsWith('--webpwd') || lower.startsWith('--btcode')
  );
}

/** Redact secret args for logs / console display. */
export function redactMeshcomCommandForLog(command: string): string {
  const trimmed = command.trim();
  if (!isMeshcomSensitiveCommand(trimmed)) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  return `${parts[0]} [redacted]`;
}
