import { describe, expect, it } from 'vitest';

import { firmwareBackupFilename } from './firmwareBackup';

describe('firmwareBackupFilename', () => {
  const at = new Date(2026, 8, 7, 3, 4, 5);

  it('slugs the chip name and appends a local timestamp', () => {
    expect(firmwareBackupFilename('ESP32-S3', at)).toBe(
      'rnode-backup-esp32-s3-20260907-030405.bin',
    );
  });

  it('strips unsafe characters and falls back when nothing remains', () => {
    expect(firmwareBackupFilename('../ESP32 (rev 3)', at)).toBe(
      'rnode-backup-esp32-rev-3-20260907-030405.bin',
    );
    expect(firmwareBackupFilename('///', at)).toBe('rnode-backup-esp32-20260907-030405.bin');
  });

  it('produces names accepted by the main-process filename allowlist', () => {
    expect(firmwareBackupFilename('ESP32-C6 🚀', at)).toMatch(/^[A-Za-z0-9._-]{1,128}\.bin$/);
  });
});
