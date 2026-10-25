import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js';
import yaml from 'js-yaml';
import path from 'path';
import {
  archKeyFromElectronBuilder,
  packSidecarResourcePath,
  resolveStagedSidecarPathForPackContext,
  stagedSidecarPath,
} from './reticulum-sidecar-staging.mjs';

const projectRoot = '/repo/mesh-client';

describe('reticulum-sidecar-staging', () => {
  it('maps electron-builder Arch enum to staging keys', () => {
    expect(archKeyFromElectronBuilder(1)).toBe('x64');
    expect(archKeyFromElectronBuilder(3)).toBe('arm64');
    expect(() => archKeyFromElectronBuilder(0)).toThrow(/Unsupported electron-builder arch/);
  });

  it('resolves staged sidecar paths per platform and arch', () => {
    expect(stagedSidecarPath(projectRoot, 'win32', 'x64')).toBe(
      path.join(
        projectRoot,
        'resources/reticulum-sidecar/staged/win32-x64/mesh-client-reticulum.exe',
      ),
    );
    expect(stagedSidecarPath(projectRoot, 'win32', 'arm64')).toBe(
      path.join(
        projectRoot,
        'resources/reticulum-sidecar/staged/win32-arm64/mesh-client-reticulum.exe',
      ),
    );
    expect(stagedSidecarPath(projectRoot, 'linux', 'arm64')).toBe(
      path.join(
        projectRoot,
        'resources/reticulum-sidecar/staged/linux-arm64/mesh-client-reticulum',
      ),
    );
    expect(stagedSidecarPath(projectRoot, 'darwin', 'arm64')).toBe(
      path.join(
        projectRoot,
        'resources/reticulum-sidecar/staged/darwin-arm64/mesh-client-reticulum',
      ),
    );
    expect(stagedSidecarPath(projectRoot, 'darwin', 'x64')).toBe(
      path.join(projectRoot, 'resources/reticulum-sidecar/staged/darwin-x64/mesh-client-reticulum'),
    );
  });

  it('resolves pack context paths for beforePack hook', () => {
    expect(resolveStagedSidecarPathForPackContext(projectRoot, 'win32', 3)).toBe(
      stagedSidecarPath(projectRoot, 'win32', 'arm64'),
    );
    expect(packSidecarResourcePath(projectRoot, 'win32')).toBe(
      path.join(projectRoot, 'resources/reticulum-sidecar/mesh-client-reticulum.exe'),
    );
    expect(packSidecarResourcePath(projectRoot, 'linux')).toBe(
      path.join(projectRoot, 'resources/reticulum-sidecar/mesh-client-reticulum'),
    );
  });
});

describe('packaged sidecar resources', () => {
  it('ships the selected binary without staging copies for either architecture', () => {
    const config = yaml.load(readFileSync('electron-builder.yml', 'utf8'));
    const resource = config.extraResources.find(
      (entry) => entry.from === 'resources/reticulum-sidecar',
    );
    const source = path.join(projectRoot, resource.from);
    const matcher = new FileMatcher(
      source,
      '/bundle/reticulum-sidecar',
      (value) => value,
      resource.filter,
    );
    const filter = matcher.createFilter();
    const file = { isDirectory: () => false };
    const directory = { isDirectory: () => true };

    expect(filter(path.join(source, 'mesh-client-reticulum'), file)).toBe(true);
    expect(filter(path.join(source, 'mesh-client-reticulum.exe'), file)).toBe(true);
    expect(filter(path.join(source, 'README.md'), file)).toBe(true);
    expect(filter(path.join(source, 'staged'), directory)).toBe(false);
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const arch of ['x64', 'arm64']) {
        const staged = path.join(source, 'staged', `${platform}-${arch}`);
        expect(filter(staged, directory)).toBe(false);
        expect(filter(path.join(staged, 'mesh-client-reticulum'), file)).toBe(false);
        expect(filter(path.join(staged, 'mesh-client-reticulum.exe'), file)).toBe(false);
        expect(filter(path.join(staged, 'RESOLVED_SHAS.txt'), file)).toBe(false);
      }
    }
  });
});
