/**
 * Flatpak offline pnpm store version must match the packageManager major
 * (pnpm 11 → store v11). flatpak-node-generator defaults to v10 for lockfile 9.
 */
import fs from 'node:fs';
import path from 'node:path';

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

/** Documented local CI-pin venv (see check:flatpak-offline-pnpm install hint). */
export const FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR = '.cache/flatpak-node-venv';

/**
 * Marker written into the pinned generator's special.py so Playwright browser
 * zips are not vendored. GitHub `github.com/…/raw/…` 404s; Flatpak uses
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (Electron E2E).
 */
export const PLAYWRIGHT_SPECIAL_SKIP_MARKER = 'mesh-client-skip-playwright-browsers';

/** Exact upstream dispatch in special.py (ac5a296a). */
export const PLAYWRIGHT_SPECIAL_SOURCE_CALL = `        elif package.name == 'playwright':
            await self._handle_playwright(package)`;

export const PLAYWRIGHT_SPECIAL_SOURCE_SKIP = `        elif package.name == 'playwright':
            # mesh-client-skip-playwright-browsers: GitHub github.com/.../raw/... 404s;
            # Flatpak uses PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (Electron E2E).
            pass`;

/**
 * Rewrite generator special.py so Playwright does not fetch browsers.json.
 *
 * @param {string} source
 * @returns {{ source: string, changed: boolean, already: boolean, missing: boolean }}
 */
export function rewriteGeneratorSkipPlaywrightSpecialSources(source) {
  if (source.includes(PLAYWRIGHT_SPECIAL_SKIP_MARKER)) {
    return { source, changed: false, already: true, missing: false };
  }
  if (!source.includes(PLAYWRIGHT_SPECIAL_SOURCE_CALL)) {
    return { source, changed: false, already: false, missing: true };
  }
  return {
    source: source.replace(PLAYWRIGHT_SPECIAL_SOURCE_CALL, PLAYWRIGHT_SPECIAL_SOURCE_SKIP),
    changed: true,
    already: false,
    missing: false,
  };
}

/**
 * Locate special.py next to a generator console-script (venv or pip --user).
 *
 * @param {string} generatorBin
 * @param {{
 *   existsSync?: (p: string) => boolean;
 *   globSync?: (pattern: string, opts: { cwd: string }) => string[];
 * }} [opts]
 * @returns {string | null}
 */
export function resolveGeneratorSpecialPyPath(generatorBin, opts = {}) {
  if (!generatorBin) return null;
  const exists = opts.existsSync ?? ((p) => fs.existsSync(p));
  const glob = opts.globSync ?? ((pattern, o) => fs.globSync(pattern, { cwd: o.cwd }));
  const binDir = path.dirname(generatorBin);
  const roots = [path.dirname(binDir)];
  const patterns = [
    'lib/python*/site-packages/flatpak_node_generator/providers/special.py',
    'lib/python*/dist-packages/flatpak_node_generator/providers/special.py',
  ];
  for (const root of roots) {
    for (const pattern of patterns) {
      let hits;
      try {
        hits = glob(pattern, { cwd: root });
      } catch {
        // catch-no-log-ok glob miss is a normal miss
        hits = [];
      }
      for (const rel of hits) {
        const abs = path.join(root, rel);
        if (exists(abs)) return abs;
      }
    }
  }
  return null;
}

/**
 * Patch an installed generator so Playwright special sources are skipped.
 *
 * @param {string} specialPyPath
 * @param {{
 *   readFileSync?: (p: string, enc: BufferEncoding) => string;
 *   writeFileSync?: (p: string, data: string, enc: BufferEncoding) => void;
 * }} [opts]
 * @returns {{ ok: true, already: boolean } | { ok: false, message: string }}
 */
export function applyGeneratorSkipPlaywrightSpecialSources(specialPyPath, opts = {}) {
  const read = opts.readFileSync ?? ((p, enc) => fs.readFileSync(p, enc));
  const write = opts.writeFileSync ?? ((p, data, enc) => fs.writeFileSync(p, data, enc));
  let source;
  try {
    source = read(specialPyPath, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `could not read ${specialPyPath}: ${detail}` };
  }
  const rewritten = rewriteGeneratorSkipPlaywrightSpecialSources(source);
  if (rewritten.already) {
    return { ok: true, already: true };
  }
  if (rewritten.missing) {
    return {
      ok: false,
      message:
        `${specialPyPath} has no playwright special-source dispatch ` +
        `(expected elif package.name == 'playwright'). Bump the generator pin or update ` +
        `PLAYWRIGHT_SPECIAL_SOURCE_CALL.`,
    };
  }
  try {
    write(specialPyPath, rewritten.source, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `could not write ${specialPyPath}: ${detail}` };
  }
  return { ok: true, already: false };
}

/**
 * Resolve flatpak-node-generator: FLATPAK_NODE_GENERATOR → PATH → local CI-pin venv.
 *
 * @param {{
 *   root: string;
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
 *   which?: (() => string | null) | null;
 *   platform?: NodeJS.Platform;
 *   existsSync?: (p: string) => boolean;
 *   accessSync?: (p: string, mode?: number) => void;
 *   X_OK?: number;
 * }} opts
 * @returns {string | null}
 */
export function resolveFlatpakNodeGeneratorBin(opts) {
  const env = opts.env ?? process.env;
  const fromEnv =
    typeof env.FLATPAK_NODE_GENERATOR === 'string' ? env.FLATPAK_NODE_GENERATOR.trim() : '';
  if (fromEnv) return fromEnv;

  if (opts.which) {
    const fromPath = opts.which()?.trim();
    if (fromPath) return fromPath;
  }

  const platform = opts.platform ?? process.platform;
  const exists = opts.existsSync ?? ((p) => fs.existsSync(p));
  const access = opts.accessSync ?? ((p, mode) => fs.accessSync(p, mode));
  const xOk = opts.X_OK ?? fs.constants.X_OK;

  /** @param {string} candidate */
  const usable = (candidate) => {
    try {
      if (!exists(candidate)) return false;
      access(candidate, xOk);
      return true;
    } catch {
      // catch-no-log-ok missing/non-executable local venv is a normal miss, not a fault
      return false;
    }
  };

  if (platform === 'win32') {
    const winBin = path.join(
      opts.root,
      FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR,
      'Scripts',
      'flatpak-node-generator.exe',
    );
    return usable(winBin) ? winBin : null;
  }

  const unixBin = path.join(
    opts.root,
    FLATPAK_NODE_GENERATOR_LOCAL_VENV_DIR,
    'bin',
    'flatpak-node-generator',
  );
  if (usable(unixBin)) return unixBin;

  return null;
}

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

  const commands = listWorkflowNonCommentShellCommands(workflowYaml);
  const patchIdx = commands.findIndex((c) =>
    /patch-flatpak-node-generator-playwright\.mjs/.test(c),
  );
  const generatorIdx = commands.findIndex((c) => /flatpak-node-generator\s+pnpm\b/.test(c));
  if (patchIdx === -1 || (generatorIdx >= 0 && patchIdx > generatorIdx)) {
    violations.push({
      file: fileRel,
      message:
        'flatpak.yaml must run scripts/patch-flatpak-node-generator-playwright.mjs before the ' +
        'generator (GitHub github.com/.../raw/... 404s for Playwright browsers.json)',
    });
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
