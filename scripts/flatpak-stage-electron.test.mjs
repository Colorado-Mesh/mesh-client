// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isElectronBinaryInstalled } from './electron-binary.mjs';
import { stageFlatpakElectron } from './flatpak-stage-electron.mjs';

describe('stageFlatpakElectron', () => {
  it('copies electron-prebuilt into node_modules/electron/dist', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-flatpak-electron-'));
    const prebuiltDir = path.join(root, 'electron-prebuilt');
    const electronBin = path.join(prebuiltDir, 'electron');
    mkdirSync(prebuiltDir, { recursive: true });
    writeFileSync(electronBin, '#!/bin/sh\n', { mode: 0o755 });

    stageFlatpakElectron({ root, prebuiltDir });

    expect(isElectronBinaryInstalled(root, 'linux')).toBe(true);
  });
});
