import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { prepareAppImageExtractDir } from './test-linux-appimage-reticulum-sidecar.mjs';

describe('test-linux-appimage-reticulum-sidecar', () => {
  it('prepareAppImageExtractDir creates cwd so spawnSync does not fail with ENOENT', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-extract-'));
    const extractDir = path.join(parent, 'extract');
    try {
      prepareAppImageExtractDir(extractDir);
      expect(existsSync(extractDir)).toBe(true);

      const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: extractDir });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
