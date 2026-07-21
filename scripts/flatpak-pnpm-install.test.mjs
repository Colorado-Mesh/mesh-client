// @vitest-environment node
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FLATPAK_PNPM_INSTALL_ARGS,
  sanitizeFlatpakPnpmStoreDirConfig,
} from './flatpak-pnpm-install.mjs';

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'flatpak-pnpm-install.mjs',
);

/** @type {string[]} */
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('flatpak-pnpm-install.mjs', () => {
  it('exits non-zero when offline store is unavailable outside sandbox', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: path.resolve(path.dirname(scriptPath), '..'),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/flatpak-pnpm|ERR_PNPM|offline|no such file/i);
  });

  it('passes trust-lockfile so offline install skips registry supply-chain re-verify', () => {
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--config.trust-lockfile=true');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--offline');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--frozen-lockfile');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--ignore-scripts');
    expect(FLATPAK_PNPM_INSTALL_ARGS).toContain('--store-dir');
  });

  it('strips generator storeDir= from workspace before install (Flatpak CI regression)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-flatpak-sanitize-'));
    tempRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'nodeLinker: hoisted\nstoreDir=/__w/mesh-client/bad-store\n',
      'utf8',
    );
    fs.writeFileSync(path.join(root, '.npmrc'), 'store-dir=/__w/host\n', 'utf8');

    const result = sanitizeFlatpakPnpmStoreDirConfig(root);
    expect(result).toEqual({ workspaceRemoved: 1, npmrcRemoved: 1 });
    expect(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(
      'nodeLinker: hoisted\n',
    );
    expect(fs.readFileSync(path.join(root, '.npmrc'), 'utf8')).toBe('');
  });
});
