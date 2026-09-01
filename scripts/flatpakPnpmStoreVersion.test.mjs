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
  resolveGeneratorSpecialPyPath,
  rewriteGeneratorSkipPlaywrightSpecialSources,
  rewriteGeneratorSkipElectronArmv7l,
  PLAYWRIGHT_SPECIAL_SKIP_MARKER,
  PLAYWRIGHT_SPECIAL_SOURCE_CALL,
  ELECTRON_ARMV7L_SKIP_MARKER,
  ELECTRON_IA32_SKIP_BLOCK,
  applyGeneratorSkipPlaywrightSpecialSources,
  applyGeneratorSkipElectronArmv7l,
  resolveGeneratorElectronPyPath,
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
      node scripts/patch-flatpak-node-generator-playwright.mjs
      flatpak-node-generator pnpm pnpm-lock.yaml -o flatpak/generated-sources.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(bad, 'v11').length).toBe(1);

    const good = `
      node scripts/patch-flatpak-node-generator-playwright.mjs
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o flatpak/generated-sources.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(good, 'v11')).toEqual([]);

    const wrong = `
      node scripts/patch-flatpak-node-generator-playwright.mjs
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v10 -o out.json
    `;
    expect(flatpakWorkflowStoreVersionViolations(wrong, 'v11')[0].message).toMatch(/v10/);
  });

  it('requires Playwright special-source skip before the generator', () => {
    const missingPatch = `
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o out.json
    `;
    expect(
      flatpakWorkflowStoreVersionViolations(missingPatch, 'v11').some((v) =>
        /patch-flatpak-node-generator-playwright/.test(v.message),
      ),
    ).toBe(true);

    const afterGenerator = `
      flatpak-node-generator pnpm pnpm-lock.yaml --pnpm-store-version v11 -o out.json
      node scripts/patch-flatpak-node-generator-playwright.mjs
    `;
    expect(
      flatpakWorkflowStoreVersionViolations(afterGenerator, 'v11').some((v) =>
        /patch-flatpak-node-generator-playwright/.test(v.message),
      ),
    ).toBe(true);
  });

  it('accepts store version derived from packageManager via shell var', () => {
    const yaml = `
      PNPM_MAJOR="$(node -p "require('./package.json').packageManager.match(/^pnpm@(\\\\d+)/)[1]")"
      STORE_VERSION="v\${PNPM_MAJOR}"
      node scripts/patch-flatpak-node-generator-playwright.mjs
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
      node scripts/patch-flatpak-node-generator-playwright.mjs
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

  it('rewrites playwright special-source dispatch to a no-op', () => {
    const upstream = `${PLAYWRIGHT_SPECIAL_SOURCE_CALL}\n        elif package.name == 'esbuild':\n`;
    const first = rewriteGeneratorSkipPlaywrightSpecialSources(upstream);
    expect(first.changed).toBe(true);
    expect(first.missing).toBe(false);
    expect(first.source).toContain(PLAYWRIGHT_SPECIAL_SKIP_MARKER);
    expect(first.source).toContain('pass');
    expect(first.source).not.toContain('await self._handle_playwright(package)');

    const second = rewriteGeneratorSkipPlaywrightSpecialSources(first.source);
    expect(second.changed).toBe(false);
    expect(second.already).toBe(true);

    const missing = rewriteGeneratorSkipPlaywrightSpecialSources(
      'elif package.name == "esbuild":\n',
    );
    expect(missing.missing).toBe(true);
    expect(missing.changed).toBe(false);
  });

  it('resolves special.py from a venv-style generator bin', () => {
    const specialRel = 'lib/python3.12/site-packages/flatpak_node_generator/providers/special.py';
    const specialAbs = path.join('/venv', specialRel);
    expect(
      resolveGeneratorSpecialPyPath('/venv/bin/flatpak-node-generator', {
        existsSync: (p) => p === specialAbs,
        globSync: (pattern, opts) => {
          expect(opts.cwd).toBe('/venv');
          expect(pattern).toContain('special.py');
          return [specialRel];
        },
      }),
    ).toBe(specialAbs);
  });

  it('applies skip rewrite to a special.py fixture', () => {
    // In-memory map only — use a site-packages path, not os.tmpdir()/`/tmp/`
    // (CodeQL js/insecure-temporary-file taints /tmp strings into writeFileSync).
    const specialPy =
      '/venv/lib/python3.12/site-packages/flatpak_node_generator/providers/special.py';
    const files = new Map([[specialPy, PLAYWRIGHT_SPECIAL_SOURCE_CALL]]);
    const first = applyGeneratorSkipPlaywrightSpecialSources(specialPy, {
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: (p, data) => {
        files.set(p, data);
      },
    });
    expect(first).toEqual({ ok: true, already: false });
    expect(files.get(specialPy)).toContain(PLAYWRIGHT_SPECIAL_SKIP_MARKER);

    const second = applyGeneratorSkipPlaywrightSpecialSources(specialPy, {
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: () => {
        throw new Error('should not rewrite when already applied');
      },
    });
    expect(second).toEqual({ ok: true, already: true });
  });

  it('rewrites electron.py to skip linux-armv7l for Electron >= 44', () => {
    const upstream = `for electron_arch, flatpak_arch in self.ELECTRON_ARCHES_TO_FLATPAK.items():
${ELECTRON_IA32_SKIP_BLOCK}
            binary_filename = f'{binary}-v{self.version}-linux-{electron_arch}.zip'
`;
    const first = rewriteGeneratorSkipElectronArmv7l(upstream);
    expect(first.changed).toBe(true);
    expect(first.missing).toBe(false);
    expect(first.source).toContain(ELECTRON_ARMV7L_SKIP_MARKER);
    expect(first.source).toContain("electron_arch == 'armv7l'");

    const second = rewriteGeneratorSkipElectronArmv7l(first.source);
    expect(second.changed).toBe(false);
    expect(second.already).toBe(true);

    const missing = rewriteGeneratorSkipElectronArmv7l('no ia32 skip here\n');
    expect(missing.missing).toBe(true);
    expect(missing.changed).toBe(false);
  });

  it('resolves electron.py from a venv-style generator bin', () => {
    const electronRel = 'lib/python3.12/site-packages/flatpak_node_generator/electron.py';
    const electronAbs = path.join('/venv', electronRel);
    expect(
      resolveGeneratorElectronPyPath('/venv/bin/flatpak-node-generator', {
        existsSync: (p) => p === electronAbs,
        globSync: (pattern, opts) => {
          expect(opts.cwd).toBe('/venv');
          expect(pattern).toContain('electron.py');
          return [electronRel];
        },
      }),
    ).toBe(electronAbs);
  });

  it('applies Electron armv7l skip rewrite to an electron.py fixture', () => {
    const electronPy = '/venv/lib/python3.12/site-packages/flatpak_node_generator/electron.py';
    const files = new Map([[electronPy, ELECTRON_IA32_SKIP_BLOCK]]);
    const first = applyGeneratorSkipElectronArmv7l(electronPy, {
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: (p, data) => {
        files.set(p, data);
      },
    });
    expect(first).toEqual({ ok: true, already: false });
    expect(files.get(electronPy)).toContain(ELECTRON_ARMV7L_SKIP_MARKER);

    const second = applyGeneratorSkipElectronArmv7l(electronPy, {
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: () => {
        throw new Error('should not rewrite when already applied');
      },
    });
    expect(second).toEqual({ ok: true, already: true });
  });
});
