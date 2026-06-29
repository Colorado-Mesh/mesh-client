import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/virtual/app',
    isPackaged: false,
    getPath: () => '/tmp/mesh-client-test',
  },
}));

vi.mock('./log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

import {
  findReticulumSidecarProjectDir,
  resolveSidecarBinaryPath,
  sidecarBinaryName,
} from './reticulum-sidecar-path';

describe('reticulum-sidecar-path', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('findReticulumSidecarProjectDir locates Cargo.toml under extra roots', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-'));
    const projectDir = path.join(tmpDir, 'reticulum-sidecar');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\n');

    expect(findReticulumSidecarProjectDir([tmpDir])).toBe(projectDir);
  });

  it('resolveSidecarBinaryPath prefers debug build under project dir', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-'));
    const projectDir = path.join(tmpDir, 'reticulum-sidecar');
    const binary = path.join(projectDir, 'target', 'debug', sidecarBinaryName());
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\n');
    fs.writeFileSync(binary, '');

    expect(resolveSidecarBinaryPath([tmpDir])).toBe(binary);
  });
});
