/**
 * Flatpak offline pnpm store version must match the packageManager major
 * (pnpm 11 → store v11). flatpak-node-generator defaults to v10 for lockfile 9.
 */

/**
 * Pinned flatpak-builder-tools commit used by Flatpak CI + PR offline checks.
 * Must include ac5a296a (YAML `storeDir: ` for pnpm store v11 — npmrc `storeDir=`
 * appended to pnpm-workspace.yaml breaks Flatpak `pnpm install`).
 */
export const FLATPAK_NODE_GENERATOR_COMMIT = 'ac5a296ac6111aa2319daf532f609a067b88d8a9';

export const FLATPAK_NODE_GENERATOR_GIT = `git+https://github.com/flatpak/flatpak-builder-tools@${FLATPAK_NODE_GENERATOR_COMMIT}#subdirectory=node`;

/**
 * pip install args for the pinned generator.
 *
 * Failure point: flathub-infra Flatpak containers (and some CI images) preinstall
 * `flatpak_node_generator==0.1.0`. Upstream keeps that version pinned across commits, so
 * plain `pip install git+…@ac5a296` is a no-op and leaves the older `storeDir=` generator.
 * Fallback: `--force-reinstall` (and `--no-cache-dir` so a stale wheel cannot win).
 */
export const FLATPAK_NODE_GENERATOR_PIP_INSTALL_ARGS = [
  'install',
  '--force-reinstall',
  '--no-cache-dir',
  FLATPAK_NODE_GENERATOR_GIT,
];

/** Shell one-liner for workflows / docs (keep in sync with PIP_INSTALL_ARGS). */
export const FLATPAK_NODE_GENERATOR_PIP_INSTALL_CMD = `pip3 ${FLATPAK_NODE_GENERATOR_PIP_INSTALL_ARGS.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ')}`;

/**
 * @param {string | null | undefined} packageManager
 * @returns {number | null}
 */
export function pnpmMajorFromPackageManager(packageManager) {
  if (typeof packageManager !== 'string' || !packageManager.startsWith('pnpm@')) {
    return null;
  }
  const version = packageManager.slice('pnpm@'.length).split('+', 1)[0];
  const m = version.match(/^(\d+)\./);
  if (!m) return null;
  return Number(m[1]);
}

/**
 * @param {number} pnpmMajor
 * @returns {string}
 */
export function expectedPnpmStoreVersion(pnpmMajor) {
  return `v${pnpmMajor}`;
}

/**
 * @param {string} packageManager
 * @returns {string | null}
 */
export function storeVersionFromPackageManager(packageManager) {
  const major = pnpmMajorFromPackageManager(packageManager);
  if (major == null) return null;
  return expectedPnpmStoreVersion(major);
}

/**
 * Collect non-comment shell command text from a GitHub Actions workflow YAML.
 * Joins lines continued with a trailing `\`. Skips `#` comments and empty lines.
 *
 * @param {string} workflowYaml
 * @returns {string[]}
 */
export function listWorkflowNonCommentShellCommands(workflowYaml) {
  /** @type {string[]} */
  const commands = [];
  /** @type {string[]} */
  let current = [];

  const flush = () => {
    if (current.length === 0) return;
    commands.push(current.join(' ').replace(/\s+/g, ' ').trim());
    current = [];
  };

  for (const rawLine of workflowYaml.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      flush();
      continue;
    }

    const continued = /\\$/.test(trimmed);
    const piece = continued ? trimmed.slice(0, -1).trimEnd() : trimmed;
    current.push(piece);
    if (!continued) flush();
  }
  flush();
  return commands;
}

/**
 * True when a shell command installs flatpak-builder-tools / the node generator pin.
 * @param {string} command
 * @returns {boolean}
 */
export function isFlatpakNodeGeneratorPipInstallCommand(command) {
  if (!/\bpip3?\s+install\b/.test(command)) return false;
  return (
    /flatpak-builder-tools/.test(command) ||
    /\$\{?FBTOOLS\}?/.test(command) ||
    /FLATPAK_NODE_GENERATOR_GIT/.test(command)
  );
}

/**
 * Ensure CI/Flatpak workflows force-reinstall the pinned generator (same 0.1.0 version
 * across commits — plain pip install is a no-op on preinstalled images).
 *
 * Flags must appear on the generator's own non-comment `pip install` command — not
 * only in a nearby comment or an unrelated pip install.
 *
 * @param {string} workflowYaml
 * @param {string} [fileRel]
 * @returns {{ file: string, message: string }[]}
 */
export function flatpakWorkflowGeneratorInstallViolations(
  workflowYaml,
  fileRel = '.github/workflows/flatpak.yaml',
) {
  /** @type {{ file: string, message: string }[]} */
  const violations = [];
  const generatorInstalls = listWorkflowNonCommentShellCommands(workflowYaml).filter(
    isFlatpakNodeGeneratorPipInstallCommand,
  );
  if (generatorInstalls.length === 0) {
    return violations;
  }

  for (const cmd of generatorInstalls) {
    const missing = [];
    if (!/--force-reinstall\b/.test(cmd)) missing.push('--force-reinstall');
    if (!/--no-cache-dir\b/.test(cmd)) missing.push('--no-cache-dir');
    if (missing.length === 0) continue;
    violations.push({
      file: fileRel,
      message:
        `pip install of flatpak-node-generator must include ${missing.join(' and ')} on the ` +
        'install command itself (not only in comments). Image may preinstall ' +
        'flatpak_node_generator==0.1.0; same version skips upgrade and leaves storeDir=.',
    });
  }
  return violations;
}

/**
 * @param {string} workflowYaml
 * @param {string} expectedStoreVersion e.g. v11
 * @param {string} [fileRel]
 * @returns {{ file: string, message: string }[]}
 */
export function flatpakWorkflowStoreVersionViolations(
  workflowYaml,
  expectedStoreVersion,
  fileRel = '.github/workflows/flatpak.yaml',
) {
  /** @type {{ file: string, message: string }[]} */
  const violations = [];

  if (!/flatpak-node-generator\s+pnpm\b/.test(workflowYaml)) {
    violations.push({
      file: fileRel,
      message: 'flatpak.yaml must invoke flatpak-node-generator pnpm …',
    });
    return violations;
  }

  violations.push(...flatpakWorkflowGeneratorInstallViolations(workflowYaml, fileRel));

  // Accept an explicit --pnpm-store-version vN, or a shell var set from packageManager.
  // Flag may be on a continued line after `flatpak-node-generator pnpm … \`.
  const explicit = workflowYaml.match(
    /flatpak-node-generator\s+pnpm\b[\s\S]{0,400}?--pnpm-store-version\s+(\S+)/,
  );
  if (explicit) {
    const flag = explicit[1].replace(/^["']|["']$/g, '');
    if (flag === expectedStoreVersion) {
      return violations;
    }
    if (flag.startsWith('$') || flag.startsWith('${')) {
      // Dynamic: require nearby derivation from package.json packageManager major.
      if (
        !/packageManager\.match\(/.test(workflowYaml) &&
        !/packageManager.*pnpm@/.test(workflowYaml) &&
        !/store.?version.*packageManager/i.test(workflowYaml) &&
        !/PNPM_MAJOR=/.test(workflowYaml)
      ) {
        violations.push({
          file: fileRel,
          message: `flatpak.yaml uses --pnpm-store-version ${flag} but does not derive it from package.json packageManager (expected ${expectedStoreVersion} for current pin)`,
        });
      }
      return violations;
    }
    violations.push({
      file: fileRel,
      message: `flatpak.yaml --pnpm-store-version is ${flag}, expected ${expectedStoreVersion} (pnpm packageManager major)`,
    });
    return violations;
  }

  violations.push({
    file: fileRel,
    message: `flatpak.yaml flatpak-node-generator must pass --pnpm-store-version ${expectedStoreVersion} (generator defaults to v10; pnpm ${expectedStoreVersion.slice(1)} needs ${expectedStoreVersion})`,
  });
  return violations;
}

/**
 * Parse package keys from the lockfile `packages:` map (name@version).
 * @param {string} lockfileText
 * @returns {string[]}
 */
export function listLockfilePackageIds(lockfileText) {
  const ids = [];
  let inPackages = false;
  for (const line of lockfileText.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }
    if (!inPackages) continue;
    const m = line.match(/^ {2}('([^']+)'|"([^"]+)"|([^:\s]+)):/);
    if (!m) continue;
    const id = m[2] ?? m[3] ?? m[4];
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * flatpak-node-generator tarball key for an npm package id (`@scope/name@1.2.3`).
 * @param {string} packageId
 * @returns {string | null}
 */
export function lockfilePackageIdToTarballName(packageId) {
  // Skip non-registry / link peers that are not simple name@version.
  if (packageId.includes('(') || packageId.includes('link:') || packageId.includes('file:')) {
    return null;
  }
  const at = packageId.lastIndexOf('@');
  if (at <= 0) return null;
  const name = packageId.slice(0, at);
  const version = packageId.slice(at + 1);
  if (!name || !version || version.includes('/')) return null;
  // Git / URL versions are not npm tarball names.
  if (/^(https?:|git\+|github:)/i.test(version)) return null;
  return `${name.replace('/', '__')}-${version}.tgz`;
}

/**
 * @param {unknown} generatedSources
 * @returns {{ storeVersion: string | null, tarballNames: Set<string> }}
 */
export function parseGeneratedPnpmManifest(generatedSources) {
  if (!Array.isArray(generatedSources)) {
    return { storeVersion: null, tarballNames: new Set() };
  }
  for (const item of generatedSources) {
    if (!item || typeof item !== 'object') continue;
    const destFilename = /** @type {{ 'dest-filename'?: unknown }} */ (item)['dest-filename'];
    const contents = /** @type {{ contents?: unknown }} */ (item).contents;
    if (destFilename !== 'pnpm-manifest.json' || typeof contents !== 'string') continue;
    try {
      const manifest = JSON.parse(contents);
      const storeVersion =
        typeof manifest.store_version === 'string' ? manifest.store_version : null;
      const packages =
        manifest.packages && typeof manifest.packages === 'object' ? manifest.packages : {};
      return { storeVersion, tarballNames: new Set(Object.keys(packages)) };
    } catch {
      return { storeVersion: null, tarballNames: new Set() };
    }
  }
  return { storeVersion: null, tarballNames: new Set() };
}

/**
 * Shell commands from flatpak-node-generator that touch pnpm-workspace.yaml.
 * @param {unknown} generatedSources
 * @returns {string[]}
 */
export function listGeneratedPnpmWorkspaceShellCommands(generatedSources) {
  /** @type {string[]} */
  const commands = [];
  if (!Array.isArray(generatedSources)) return commands;
  for (const item of generatedSources) {
    if (!item || typeof item !== 'object') continue;
    const type = /** @type {{ type?: unknown }} */ (item).type;
    const cmds = /** @type {{ commands?: unknown }} */ (item).commands;
    if (type !== 'shell' || !Array.isArray(cmds)) continue;
    for (const cmd of cmds) {
      if (typeof cmd !== 'string') continue;
      if (!cmd.includes('pnpm-workspace.yaml')) continue;
      commands.push(cmd);
    }
  }
  return commands;
}

/**
 * flatpak-builder-tools before ac5a296a echoed npmrc `storeDir=` into
 * pnpm-workspace.yaml, which is invalid YAML and fails Flatpak pnpm install.
 *
 * @param {unknown} generatedSources
 * @param {string} [fileRel]
 * @returns {{ file: string, message: string }[]}
 */
export function generatedSourcesStoreDirYamlViolations(
  generatedSources,
  fileRel = 'flatpak/generated-sources.json',
) {
  /** @type {{ file: string, message: string }[]} */
  const violations = [];
  const commands = listGeneratedPnpmWorkspaceShellCommands(generatedSources);

  for (const cmd of commands) {
    // npmrc-style key=value is not valid in pnpm-workspace.yaml.
    if (/storeDir\s*=/.test(cmd) && !/storeDir\s*:\s*/.test(cmd)) {
      violations.push({
        file: fileRel,
        message:
          'shell command appends npmrc-style storeDir= to pnpm-workspace.yaml ' +
          '(invalid YAML; Flatpak pnpm install fails). Bump flatpak-node-generator ' +
          'to ac5a296a+ so it echoes "storeDir: $PWD/…".',
      });
    }
  }

  return violations;
}

/**
 * Apply a generator-style storeDir append to workspace YAML and return whether
 * the result still parses (same failure class as Flatpak `pnpm install`).
 *
 * @param {string} workspaceYaml
 * @param {string} storeDirLine e.g. 'storeDir=/tmp/store' or 'storeDir: /tmp/store'
 * @param {{ load?: (input: string) => unknown }} [yaml]
 * @returns {{ ok: true, storeDir?: unknown } | { ok: false, reason: string }}
 */
export function probePnpmWorkspaceAfterStoreDirAppend(
  workspaceYaml,
  storeDirLine,
  yaml = undefined,
) {
  const combined = `${workspaceYaml.replace(/\s*$/, '')}\n${storeDirLine}\n`;
  try {
    // Prefer real YAML parse when provided (vitest / check script); else heuristic.
    if (yaml && typeof yaml.load === 'function') {
      const doc = yaml.load(combined);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return { ok: false, reason: 'parsed workspace is not a mapping' };
      }
      return { ok: true, storeDir: /** @type {Record<string, unknown>} */ (doc).storeDir };
    }
    // Validate the appended line itself — an existing `storeDir:` in the
    // workspace must not mask a newly appended npmrc-style `storeDir=`.
    if (/^\s*storeDir\s*=/.test(storeDirLine)) {
      return {
        ok: false,
        reason: 'storeDir= npmrc line is not valid YAML in pnpm-workspace.yaml',
      };
    }
    if (/^\s*storeDir\s*:/.test(storeDirLine)) {
      return { ok: true };
    }
    return { ok: false, reason: 'missing storeDir YAML key after append' };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: detail };
  }
}

/**
 * Strip generator-appended `storeDir` keys from pnpm-workspace.yaml.
 *
 * Failure point: flatpak-node-generator shell sources append either invalid
 * `storeDir=` (pre-ac5a296a) or a host-cache `storeDir: $PWD/…` path that is
 * unreachable inside the Flatpak sandbox. Fallback: remove those lines and rely
 * on `pnpm install --store-dir` (sandbox-absolute) from flatpak-pnpm-install.mjs.
 *
 * @param {string} workspaceYaml
 * @returns {{ yaml: string, removed: number }}
 */
export function stripPnpmWorkspaceStoreDirLines(workspaceYaml) {
  let removed = 0;
  const yaml = workspaceYaml
    .split('\n')
    .filter((line) => {
      if (/^\s*storeDir\s*[:=]/.test(line)) {
        removed += 1;
        return false;
      }
      return true;
    })
    .join('\n');
  return { yaml, removed };
}

/**
 * Strip `store-dir=` lines from .npmrc (v10 generator path).
 *
 * @param {string} npmrc
 * @returns {{ text: string, removed: number }}
 */
export function stripNpmrcStoreDirLines(npmrc) {
  let removed = 0;
  const text = npmrc
    .split('\n')
    .filter((line) => {
      if (/^\s*store-dir\s*=/.test(line)) {
        removed += 1;
        return false;
      }
      return true;
    })
    .join('\n');
  return { text, removed };
}

/**
 * @param {string[]} lockfilePackageIds
 * @param {Set<string>} tarballNames
 * @param {number} [sampleLimit]
 * @returns {{ missing: string[], truncated: boolean }}
 */
export function missingOfflineTarballs(lockfilePackageIds, tarballNames, sampleLimit = 20) {
  const missing = [];
  let truncated = false;
  for (const id of lockfilePackageIds) {
    const tarball = lockfilePackageIdToTarballName(id);
    if (!tarball) continue;
    if (!tarballNames.has(tarball)) {
      missing.push(tarball);
      if (missing.length >= sampleLimit) {
        truncated = true;
        break;
      }
    }
  }
  return { missing, truncated };
}
