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

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  findReticulumSidecarProjectDir,
  hasRnsStackSiblings,
  newestReticulumSidecarSourceMtimeMs,
  resolveSidecarBinaryPath,
  sidecarBinaryIsStale,
  sidecarBinaryLacksRnsBle,
  sidecarBinaryLacksRnsStack,
  sidecarBinaryName,
  sidecarCargoBuildArgs,
} from './reticulum-sidecar-path';

describe('reticulum-sidecar-path', () => {
  let tmpDir: string;

  afterEach(() => {
    spawnMock.mockReset();
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

  it('sidecarBinaryIsStale returns true when Rust source is newer than binary', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-stale-'));
    const projectDir = path.join(tmpDir, 'reticulum-sidecar');
    const srcDir = path.join(projectDir, 'src');
    const binary = path.join(projectDir, 'target', 'debug', sidecarBinaryName());
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\n');
    fs.writeFileSync(binary, '');
    fs.writeFileSync(path.join(srcDir, 'main.rs'), 'fn main() {}');

    const past = Date.now() - 60_000;
    fs.utimesSync(binary, past / 1000, past / 1000);
    const future = Date.now() + 60_000;
    fs.utimesSync(path.join(srcDir, 'main.rs'), future / 1000, future / 1000);

    expect(sidecarBinaryIsStale(binary, projectDir)).toBe(true);
    expect(newestReticulumSidecarSourceMtimeMs(projectDir)).toBeGreaterThan(
      fs.statSync(binary).mtimeMs,
    );
  });

  it('sidecarCargoBuildArgs uses rns-stack when Ratspeak siblings exist', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-siblings-'));
    const meshRoot = path.join(tmpDir, 'mesh-client');
    const projectDir = path.join(meshRoot, 'reticulum-sidecar');
    fs.mkdirSync(path.join(tmpDir, 'rsReticulum', 'crates', 'rns-runtime'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'rsLXMF', 'crates', 'lxmf-core'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'rsReticulum/crates/rns-runtime/Cargo.toml'), '[package]\n');
    fs.writeFileSync(path.join(tmpDir, 'rsLXMF/crates/lxmf-core/Cargo.toml'), '[package]\n');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "test"\n');

    expect(hasRnsStackSiblings(projectDir)).toBe(true);
    expect(sidecarCargoBuildArgs(projectDir)).toEqual(['build', '--features', 'rns-stack,rns-ble']);
  });

  it('sidecarBinaryLacksRnsBle detects sidecars built without rns-ble', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-ble-'));
    const binary = path.join(tmpDir, sidecarBinaryName());
    fs.writeFileSync(binary, 'rns-ble feature not enabled in this build');
    expect(sidecarBinaryLacksRnsBle(binary)).toBe(true);
    fs.writeFileSync(binary, 'ble_peer runtime linked');
    expect(sidecarBinaryLacksRnsBle(binary)).toBe(false);
  });

  it('sidecarBinaryLacksRnsStack detects stub-only binaries', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-reticulum-stub-'));
    const binary = path.join(tmpDir, sidecarBinaryName());
    fs.writeFileSync(binary, 'stub-sidecar-no-network-stack');
    expect(sidecarBinaryLacksRnsStack(binary)).toBe(true);
    fs.writeFileSync(binary, 'stub-sidecar-with-rns_runtime-linked');
    expect(sidecarBinaryLacksRnsStack(binary)).toBe(false);
  });
});
