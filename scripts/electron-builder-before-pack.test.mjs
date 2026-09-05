import { describe, expect, it } from 'vitest';
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
