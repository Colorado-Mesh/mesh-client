// @vitest-environment node
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  expectedPnpmStoreVersion,
  flatpakWorkflowStoreVersionViolations,
  generatedSourcesStoreDirYamlViolations,
  listGeneratedPnpmWorkspaceShellCommands,
  listLockfilePackageIds,
  lockfilePackageIdToTarballName,
  missingOfflineTarballs,
  parseGeneratedPnpmManifest,
  pnpmMajorFromPackageManager,
  probePnpmWorkspaceAfterStoreDirAppend,
  storeVersionFromPackageManager,
} from './flatpakPnpmStoreVersion.mjs';

describe('flatpakPnpmStoreVersion', () => {
  it('maps packageManager major to store version', () => {
    expect(pnpmMajorFromPackageManager('pnpm@11.15.1+sha512.abc')).toBe(11);
    expect(storeVersionFromPackageManager('pnpm@11.15.1')).toBe('v11');
    expect(expectedPnpmStoreVersion(11)).toBe('v11');
    expect(storeVersionFromPackageManager('npm@10')).toBeNull();
  });

  it('requires --pnpm-store-version matching packageManager', () => {
    const bad = `
      flatpak-node-generator pnpm pnpm-lock.yaml -o flatpak/generated-sources.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(bad, 'v11').length).toBe(1);

    const good = `
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o flatpak/generated-sources.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(good, 'v11')).toEqual([]);

    const wrong = `
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v10 -o out.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(wrong, 'v11')[0].message).toMatch(/v10/);
  });

  it('accepts store version derived from packageManager via shell var', () => {
    const yaml = `
      PNPM_MAJOR="$(node -p "require('./package.json').packageManager.match(/^pnpm@(\\\\d+)/)[1]")"
      STORE_VERSION="v\${PNPM_MAJOR}"
      flatpak-node-generator pnpm pnpm-lock.yaml \\
        --pnpm-store-version "$STORE_VERSION" \\
        -o flatpak/generated-sources.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(yaml, 'v11')).toEqual([]);
  });

  it('parses lockfile package ids and tarball names', () => {
    const lock = `
packages:

  '@bufbuild/protobuf@2.12.1':
    resolution: {integrity: sha512-abc==}

  lodash@4.17.21:
    resolution: {integrity: sha512-def==}
`;
    expect(listLockfilePackageIds(lock)).toEqual(['@bufbuild/protobuf@2.12.1', 'lodash@4.17.21']);
    expect(lockfilePackageIdToTarballName('@bufbuild/protobuf@2.12.1')).toBe(
      '@bufbuild__protobuf-2.12.1.tgz',
    );
    expect(lockfilePackageIdToTarballName('lodash@4.17.21')).toBe('lodash-4.17.21.tgz');
  });

  it('detects missing offline tarballs and parses generated manifest', () => {
    const sources = [
      {
        type: 'inline',
        'dest-filename': 'pnpm-manifest.json',
        contents: JSON.stringify({
          store_version: 'v11',
          packages: { 'lodash-4.17.21.tgz': {} },
        }),
      },
    ];
    const { storeVersion, tarballNames } = parseGeneratedPnpmManifest(sources);
    expect(storeVersion).toBe('v11');
    expect(
      missingOfflineTarballs(['@bufbuild/protobuf@2.12.1', 'lodash@4.17.21'], tarballNames),
    ).toEqual({
      missing: ['@bufbuild__protobuf-2.12.1.tgz'],
      truncated: false,
    });
  });

  it('signals truncation when missing samples hit the limit', () => {
    const { missing, truncated } = missingOfflineTarballs(
      ['a@1.0.0', 'b@1.0.0', 'c@1.0.0'],
      new Set(),
      2,
    );
    expect(missing).toEqual(['a-1.0.0.tgz', 'b-1.0.0.tgz']);
    expect(truncated).toBe(true);
  });

  it('rejects npmrc-style storeDir= shell commands targeting pnpm-workspace.yaml', () => {
    const bad = [
      {
        type: 'shell',
        commands: [
          'python3 flatpak-node/populate_pnpm_store.py …',
          'echo "storeDir=$PWD/flatpak-node/pnpm-store" >> pnpm-workspace.yaml',
        ],
      },
    ];
    expect(listGeneratedPnpmWorkspaceShellCommands(bad)).toHaveLength(1);
    expect(generatedSourcesStoreDirYamlViolations(bad)[0].message).toMatch(/storeDir=/);

    const good = [
      {
        type: 'shell',
        commands: ['echo "storeDir: $PWD/flatpak-node/pnpm-store" >> pnpm-workspace.yaml'],
      },
    ];
    expect(generatedSourcesStoreDirYamlViolations(good)).toEqual([]);
  });

  it('reproduces Flatpak CI YAML break when storeDir= is appended to workspace', () => {
    const workspace = `
patchedDependencies:
  usb@2.18.0: patches/usb@2.18.0.patch
`;
    const broken = probePnpmWorkspaceAfterStoreDirAppend(
      workspace,
      'storeDir=/__w/mesh-client/mesh-client/.flatpak-builder/…/flatpak-node/pnpm-store',
      yaml,
    );
    expect(broken.ok).toBe(false);
    expect(broken.ok === false && broken.reason).toMatch(/implicit key|YAML|storeDir=/i);

    const fixed = probePnpmWorkspaceAfterStoreDirAppend(
      workspace,
      'storeDir: /run/build/mesh-client/flatpak-node/pnpm-store',
      yaml,
    );
    expect(fixed.ok).toBe(true);
    expect(fixed.ok === true && fixed.storeDir).toBe(
      '/run/build/mesh-client/flatpak-node/pnpm-store',
    );
  });

  it('rejects appended storeDir= even when workspace already has storeDir:', () => {
    const workspace = `
storeDir: /already/set
patchedDependencies:
  usb@2.18.0: patches/usb@2.18.0.patch
`;
    const withLoader = probePnpmWorkspaceAfterStoreDirAppend(
      workspace,
      'storeDir=/__w/mesh-client/bad-store',
      yaml,
    );
    expect(withLoader.ok).toBe(false);

    // No-loader fallback must inspect the appended line, not the existing key.
    const heuristic = probePnpmWorkspaceAfterStoreDirAppend(
      workspace,
      'storeDir=/__w/mesh-client/bad-store',
    );
    expect(heuristic.ok).toBe(false);
    expect(heuristic.ok === false && heuristic.reason).toMatch(/storeDir=/);
  });
});
