/** Largest ESP32 flash chip in the RNode catalog is 16 MB; allow headroom for 32 MB parts. */
export const FIRMWARE_BACKUP_MAX_BYTES = 32 * 1024 * 1024;

export interface FirmwareBackupSaveResult {
  saved: boolean;
  path?: string;
}

/** `rnode-backup-<chip>-<YYYYMMDD-HHMMSS>.bin`, restricted to filename-safe characters. */
export function firmwareBackupFilename(chipName: string, now: Date = new Date()): string {
  const chip =
    chipName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'esp32';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `rnode-backup-${chip}-${stamp}.bin`;
}
