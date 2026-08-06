import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildRunStampSuffix,
  hasRunStamp,
  listInstallerFiles,
  parseBuildInfoEnv,
  renameTestBuildArtifacts,
  resolveTestRenameStamp,
  shouldRenameInstaller,
  stampedInstallerName,
} from './rename-test-build-artifacts.mjs';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-build-'));
  tempDirs.push(dir);
  return dir;
}

describe('buildRunStampSuffix', () => {
  it('formats -run{N}', () => {
    expect(buildRunStampSuffix(214)).toBe('-run214');
  });

  it('rejects non-integers', () => {
    expect(() => buildRunStampSuffix(1.5)).toThrow(/Invalid runNumber/);
  });
});

describe('stampedInstallerName', () => {
  it('stamps AppImage x64 and arm64', () => {
    expect(stampedInstallerName('Mesh-client-5.26.0.AppImage', 214)).toBe(
      'Mesh-client-5.26.0-run214.AppImage',
    );
    expect(stampedInstallerName('Mesh-client-5.26.0-arm64.AppImage', 214)).toBe(
      'Mesh-client-5.26.0-run214-arm64.AppImage',
    );
  });

  it('stamps deb/rpm arch markers', () => {
    expect(stampedInstallerName('mesh-client_5.26.0_amd64.deb', 7)).toBe(
      'mesh-client_5.26.0-run7_amd64.deb',
    );
    expect(stampedInstallerName('mesh-client-5.26.0.x86_64.rpm', 7)).toBe(
      'mesh-client-5.26.0-run7.x86_64.rpm',
    );
  });

  it('stamps Windows Setup installers', () => {
    expect(stampedInstallerName('Mesh-client Setup 5.26.0.exe', 214)).toBe(
      'Mesh-client Setup 5.26.0-run214.exe',
    );
    expect(stampedInstallerName('Mesh-client Setup 5.26.0-arm64.exe', 214)).toBe(
      'Mesh-client Setup 5.26.0-run214-arm64.exe',
    );
  });

  it('stamps Flatpak and is idempotent', () => {
    expect(stampedInstallerName('org.coloradomesh.MeshClient.flatpak', 214)).toBe(
      'org.coloradomesh.MeshClient-run214.flatpak',
    );
    expect(stampedInstallerName('org.coloradomesh.MeshClient-run214.flatpak', 214)).toBe(
      'org.coloradomesh.MeshClient-run214.flatpak',
    );
    expect(hasRunStamp('org.coloradomesh.MeshClient-run214.flatpak')).toBe(true);
  });
});

describe('shouldRenameInstaller', () => {
  it('accepts installers and skips non-installers', () => {
    expect(shouldRenameInstaller('Mesh-client-5.26.0.AppImage')).toBe(true);
    expect(shouldRenameInstaller('Mesh-client Setup 5.26.0.exe')).toBe(true);
    expect(shouldRenameInstaller('org.coloradomesh.MeshClient.flatpak')).toBe(true);
    expect(shouldRenameInstaller('READ-ME-FIRST-test-build.md')).toBe(false);
    expect(shouldRenameInstaller('Mesh-client.exe')).toBe(false);
    expect(shouldRenameInstaller('Mesh-client-5.26.0.AppImage.blockmap')).toBe(false);
  });
});

describe('resolveTestRenameStamp', () => {
  it('no-ops when channel is not test', () => {
    expect(resolveTestRenameStamp({ channel: 'release', runNumber: 1 })).toBeNull();
    expect(
      resolveTestRenameStamp({
        buildInfoRaw: JSON.stringify({ channel: 'local', runNumber: 9 }),
      }),
    ).toBeNull();
  });

  it('fails closed when test channel lacks runNumber', () => {
    expect(() => resolveTestRenameStamp({ channel: 'test' })).toThrow(/runNumber/);
  });

  it('parses MESH_CLIENT_BUILD_INFO', () => {
    expect(parseBuildInfoEnv(JSON.stringify({ channel: 'test', runNumber: 214 }))).toEqual({
      channel: 'test',
      runNumber: 214,
    });
  });

  it('rejects fractional and negative runNumber in parseBuildInfoEnv', () => {
    expect(() => parseBuildInfoEnv(JSON.stringify({ runNumber: 1.5 }))).toThrow(
      /non-negative integer/,
    );
    expect(() => parseBuildInfoEnv(JSON.stringify({ runNumber: -1 }))).toThrow(
      /non-negative integer/,
    );
  });

  it('rejects fractional and negative runNumber in resolveTestRenameStamp', () => {
    expect(() => resolveTestRenameStamp({ channel: 'test', runNumber: 2.5 })).toThrow(
      /non-negative integer/,
    );
    expect(() => resolveTestRenameStamp({ channel: 'test', runNumber: -3 })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('renameTestBuildArtifacts', () => {
  it('renames installers under release/ and skips non-installers', () => {
    const root = makeTempDir();
    const mac = path.join(root, 'mac');
    fs.mkdirSync(mac, { recursive: true });
    fs.writeFileSync(path.join(root, 'Mesh-client-5.26.0.AppImage'), 'x');
    fs.writeFileSync(path.join(root, 'Mesh-client-5.26.0-arm64.AppImage'), 'x');
    fs.writeFileSync(path.join(root, 'mesh-client_5.26.0_amd64.deb'), 'x');
    fs.writeFileSync(path.join(root, 'Mesh-client Setup 5.26.0.exe'), 'x');
    fs.writeFileSync(path.join(root, 'Mesh-client Setup 5.26.0-arm64.exe'), 'x');
    fs.writeFileSync(path.join(mac, 'Mesh-client-5.26.0.dmg'), 'x');
    fs.writeFileSync(path.join(root, 'READ-ME-FIRST-test-build.md'), 'note');
    fs.writeFileSync(path.join(root, 'Mesh-client.exe'), 'exe');

    const result = renameTestBuildArtifacts({
      rootDir: root,
      channel: 'test',
      runNumber: 214,
    });
    expect(result.skipped).toBe(false);
    expect(result.renamed).toHaveLength(6);
    expect(fs.existsSync(path.join(root, 'Mesh-client-5.26.0-run214.AppImage'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Mesh-client-5.26.0-run214-arm64.AppImage'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Mesh-client Setup 5.26.0-run214.exe'))).toBe(true);
    expect(fs.existsSync(path.join(mac, 'Mesh-client-5.26.0-run214.dmg'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'READ-ME-FIRST-test-build.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Mesh-client.exe'))).toBe(true);

    const again = renameTestBuildArtifacts({
      rootDir: root,
      channel: 'test',
      runNumber: 214,
    });
    expect(again.renamed).toHaveLength(0);
  });

  it('skips when channel is not test', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'Mesh-client-5.26.0.AppImage'), 'x');
    const result = renameTestBuildArtifacts({
      rootDir: root,
      buildInfoRaw: JSON.stringify({ channel: 'release', runNumber: 9 }),
    });
    expect(result).toMatchObject({ skipped: true, reason: 'channel-not-test' });
    expect(fs.existsSync(path.join(root, 'Mesh-client-5.26.0.AppImage'))).toBe(true);
  });

  it('lists only installer files', () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, 'a.AppImage'), 'x');
    fs.writeFileSync(path.join(root, 'note.md'), 'x');
    expect(listInstallerFiles(root).map((p) => path.basename(p))).toEqual(['a.AppImage']);
  });
});
