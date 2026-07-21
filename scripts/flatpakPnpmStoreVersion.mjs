/**
 * Flatpak offline pnpm store version must match the packageManager major
 * (pnpm 11 → store v11). flatpak-node-generator defaults to v10 for lockfile 9.
 */

/** Pinned flatpak-builder-tools commit used by Flatpak CI + PR offline checks. */
export const FLATPAK_NODE_GENERATOR_COMMIT = '6f3f08759ac9859492b728f57f5163bf584c47ff';

export const FLATPAK_NODE_GENERATOR_GIT = `git+https://github.com/flatpak/flatpak-builder-tools@${FLATPAK_NODE_GENERATOR_COMMIT}#subdirectory=node`;

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
 * @param {string[]} lockfilePackageIds
 * @param {Set<string>} tarballNames
 * @param {number} [sampleLimit]
 * @returns {string[]}
 */
export function missingOfflineTarballs(lockfilePackageIds, tarballNames, sampleLimit = 20) {
  const missing = [];
  for (const id of lockfilePackageIds) {
    const tarball = lockfilePackageIdToTarballName(id);
    if (!tarball) continue;
    if (!tarballNames.has(tarball)) {
      missing.push(tarball);
      if (missing.length >= sampleLimit) break;
    }
  }
  return missing;
}
