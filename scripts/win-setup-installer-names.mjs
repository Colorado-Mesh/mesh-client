/**
 * Match Mesh-client Windows NSIS Setup installer basenames.
 *
 * Accepts default electron-builder names and test-build stamped names:
 *   Mesh-client Setup 5.26.0.exe
 *   Mesh-client Setup 5.26.0-arm64.exe
 *   Mesh-client Setup 5.26.0-run214.exe
 *   Mesh-client Setup 5.26.0-run214-arm64.exe
 */

/**
 * @param {string} version package.json semver
 * @param {string} name basename
 * @returns {'x64' | 'arm64' | null}
 */
export function matchWinSetupInstallerArch(version, name) {
  if (typeof name !== 'string' || name.includes('__uninstaller')) return null;
  const prefix = `Mesh-client Setup ${version}`;
  if (!name.startsWith(prefix) || !name.endsWith('.exe')) return null;
  const rest = name.slice(prefix.length, -'.exe'.length);
  // rest: '' | '-arm64' | '-run214' | '-run214-arm64'
  if (rest === '') return 'x64';
  if (rest === '-arm64') return 'arm64';
  if (/^-run\d+$/.test(rest)) return 'x64';
  if (/^-run\d+-arm64$/.test(rest)) return 'arm64';
  return null;
}

/**
 * @param {string} version
 * @param {string[]} names release/ basenames
 * @returns {{ x64: string, arm64: string }}
 */
export function collectWinSetupInstallers(version, names) {
  /** @type {string[]} */
  const x64 = [];
  /** @type {string[]} */
  const arm64 = [];
  for (const name of names) {
    const arch = matchWinSetupInstallerArch(version, name);
    if (arch === 'x64') x64.push(name);
    else if (arch === 'arm64') arm64.push(name);
  }
  if (x64.length !== 1) {
    throw new Error(
      `Expected exactly one x64 NSIS installer, found ${x64.length}: ${x64.join(', ') || '(none)'}`,
    );
  }
  if (arm64.length !== 1) {
    throw new Error(
      `Expected exactly one arm64 NSIS installer, found ${arm64.length}: ${arm64.join(', ') || '(none)'}`,
    );
  }
  return { x64: x64[0], arm64: arm64[0] };
}

/**
 * @param {string} version
 * @param {'x64' | 'arm64'} arch
 * @param {string[]} names
 * @returns {string}
 */
export function findWinSetupInstaller(version, arch, names) {
  const hits = names.filter((name) => matchWinSetupInstallerArch(version, name) === arch);
  if (hits.length !== 1) {
    throw new Error(
      `Expected exactly one ${arch} NSIS installer, found ${hits.length}: ${hits.join(', ') || '(none)'}`,
    );
  }
  return hits[0];
}
