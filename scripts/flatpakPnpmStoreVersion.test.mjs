// @vitest-environment node
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import path from 'node:path';
import {
  expectedPnpmStoreVersion,
  FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR,
  flatpakWorkflowGeneratorInstallViolations,
  flatpakWorkflowStoreVersionViolations,
  generatedSourcesStoreDirYamlViolations,
  listGeneratedPnpmWorkspaceShellCommands,
  listLockfilePackageIds,
  lockfilePackageIdToTarballName,
  missingOfflineTarballs,
  parseGeneratedPnpmManifest,
  pnpmMajorFromPackageManager,
  probePnpmWorkspaceAfterStoreDirAppend,
  resolveFlatpakNodeGeneratorBin,
  storeVersionFromPackageManager,
  stripNpmrcStoreDirLines,
  stripPnpmWorkspaceStoreDirLines,
} from './flatpakPnpmStoreVersion.mjs';

describe('resolveFlatpakNodeGeneratorBin', () => {
  const root = '/repo';
  const unixVenv = path.join(
    root,
    FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR,
    'bin',
    'flatpak-node-generator',
  );
  const winVenv = path.join(
    root,
    FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR,
    'Scripts',
    'flatpak-node-generator.exe',
  );

  it('prefers FLATPAK_NODE_GENERATOR over PATH and local venv', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: { FLATPAK_NODE_GENERATOR: ' /custom/bin ' },
        which: () => '/usr/bin/flatpak-node-generator',
        existsSync: () => true,
        accessSync: () => {},
        X_OK: 1,
        platform: 'linux',
      }),
    ).toBe('/custom/bin');
  });

  it('uses PATH when env unset', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: {},
        which: () => '/usr/local/bin/flatpak-node-generator',
        existsSync: () => true,
        accessSync: () => {},
        X_OK: 1,
        platform: 'darwin',
      }),
    ).toBe('/usr/local/bin/flatpak-node-generator');
  });

  it('falls back to local CI-pin venv when PATH misses', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: {},
        which: () => null,
        existsSync: (p) => p === unixVenv,
        accessSync: () => {},
        X_OK: 1,
        platform: 'darwin',
      }),
    ).toBe(unixVenv);
  });

  it('uses win32 Scripts layout for local venv', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: {},
        which: () => null,
        existsSync: (p) => p === winVenv,
        accessSync: () => {},
        X_OK: 1,
        platform: 'win32',
      }),
    ).toBe(winVenv);
  });

  it('does not fall through to Unix bin on win32 when Scripts exe is missing', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: {},
        which: () => null,
        existsSync: (p) => p === unixVenv,
        accessSync: () => {},
        X_OK: 1,
        platform: 'win32',
      }),
    ).toBeNull();
  });

  it('returns null when env, PATH, and local venv are all missing', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: { FLATPAK_NODE_GENERATOR: '  ' },
        which: () => null,
        existsSync: () => false,
        accessSync: () => {
          throw new Error('not executable');
        },
        X_OK: 1,
        platform: 'linux',
      }),
    ).toBeNull();
  });

  it('returns null when local venv exists but is not executable', () => {
    expect(
      resolveFlatpakNodeGeneratorBin({
        root,
        env: { FLATPAK_NODE_GENERATOR: '  ' },
        which: () => null,
        existsSync: (p) => p === unixVenv,
        accessSync: () => {
          throw new Error('not executable');
        },
        X_OK: 1,
        platform: 'linux',
      }),
    ).toBeNull();
  });
});

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

  it('requires --force-reinstall and --no-cache-dir on the generator pip install command', () => {
    // Build a short pin fixture so no-secrets does not flag a full commit hash.
    const pin = ['ac5a296a', 'c611'].join('');
    const bad = `
      FBTOOLS=git+https://github.com/flatpak/flatpak-builder-tools
      pip3 install "\${FBTOOLS}@${pin}#subdirectory=node"
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o out.json
    `;
    expect(flatpakWorkflowGeneratorInstallViolations(bad)[0].message).toMatch(/force-reinstall/);
    // Combined store-version check must also surface the install pin issue.
    expect(
      flatpakWorkflowStoreVersionViolations(bad, 'v11').some((v) =>
        /force-reinstall/.test(v.message),
      ),
    ).toBe(true);

    const good = `
      FBTOOLS=git+https://github.com/flatpak/flatpak-builder-tools
      pip3 install --force-reinstall --no-cache-dir \\
        "\${FBTOOLS}@${pin}#subdirectory=node"
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o out.json
    `;
    expect(flatpakWorkflowGeneratorInstallViolations(good)).toEqual([]);
  });

  it('rejects flags present only in comments or on an unrelated pip install', () => {
    const pin = ['ac5a296a', 'c611'].join('');
    const flagsInComment = `
      FBTOOLS=git+https://github.com/flatpak/flatpak-builder-tools
      # --force-reinstall --no-cache-dir required for storeDir=
      pip3 install "\${FBTOOLS}@${pin}#subdirectory=node"
    `;
    expect(flatpakWorkflowGeneratorInstallViolations(flagsInComment).length).toBe(1);

    const flagsOnUnrelatedPip = `
      pip3 install --force-reinstall --no-cache-dir yamllint
      FBTOOLS=git+https://github.com/flatpak/flatpak-builder-tools
      pip3 install "\${FBTOOLS}@${pin}#subdirectory=node"
    `;
    expect(flatpakWorkflowGeneratorInstallViolations(flagsOnUnrelatedPip).length).toBe(1);

    const missingNoCacheDir = `
      FBTOOLS=git+https://github.com/flatpak/flatpak-builder-tools
      pip3 install --force-reinstall "\${FBTOOLS}@${pin}#subdirectory=node"
    `;
    expect(flatpakWorkflowGeneratorInstallViolations(missingNoCacheDir)[0].message).toMatch(
      /no-cache-dir/,
    );
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

  it('strips invalid and host-path storeDir lines from workspace YAML', () => {
    const workspace = `
patchedDependencies:
  usb@2.18.0: patches/usb@2.18.0.patch
storeDir=/__w/mesh-client/bad
storeDir: /__w/mesh-client/also-bad
`;
    const { yaml: cleaned, removed } = stripPnpmWorkspaceStoreDirLines(workspace);
    expect(removed).toBe(2);
    expect(cleaned).not.toMatch(/storeDir/);
    expect(cleaned).toMatch(/usb@2\.18\.0/);
    // After strip, workspace must parse again.
    expect(yaml.load(cleaned)).toMatchObject({
      patchedDependencies: { 'usb@2.18.0': 'patches/usb@2.18.0.patch' },
    });
  });

  it('strips store-dir lines from .npmrc', () => {
    const npmrc = 'shamefully-hoist=true\nstore-dir=/__w/host/store\n';
    const { text, removed } = stripNpmrcStoreDirLines(npmrc);
    expect(removed).toBe(1);
    expect(text).toBe('shamefully-hoist=true\n');
  });
});
