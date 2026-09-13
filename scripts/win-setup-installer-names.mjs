import fs from 'node:fs';
import path from 'node:path';

/**
 * Match Mesh-client Windows NSIS Setup installer basenames.
 *
 * Accepts default electron-builder names, hyphenated GitHub-safe names, and
 * test-build stamped names:
 *   Mesh-client Setup 5.26.0.exe
 *   Mesh-client-Setup-5.26.0.exe
 *   Mesh-client Setup 5.26.0-arm64.exe
 *   Mesh-client-Setup-5.26.0-arm64.exe
 *   Mesh-client Setup 5.26.0-run214.exe
 *   Mesh-client-Setup-5.26.0-run214.exe
 *   Mesh-client Setup 5.26.0-run214-arm64.exe
 *   Mesh-client-Setup-5.26.0-run214-arm64.exe
 */

/**
 * @param {string} version package.json semver
 * @returns {string[]}
 */
function winSetupPrefixes(version) {
  return [`Mesh-client-Setup-${version}`, `Mesh-client Setup ${version}`];
}

/**
 * @param {string} version package.json semver
 * @param {string} name basename
 * @returns {'x64' | 'arm64' | null}
 */
export function matchWinSetupInstallerArch(version, name) {
  if (typeof name !== 'string' || name.includes('__uninstaller')) return null;
  if (!name.endsWith('.exe')) return null;
  for (const prefix of winSetupPrefixes(version)) {
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length, -'.exe'.length);
    // rest: '' | '-arm64' | '-x64' | '-run214' | '-run214-arm64' | '-run214-x64'
    if (rest === '' || rest === '-x64') return 'x64';
    if (rest === '-arm64') return 'arm64';
    if (/^-run\d+$/.test(rest) || /^-run\d+-x64$/.test(rest)) return 'x64';
    if (/^-run\d+-arm64$/.test(rest)) return 'arm64';
    return null;
  }
  return null;
}

/**
 * @param {string} name basename
 * @returns {string}
 */
export function hyphenateWinSetupInstallerName(name) {
  if (typeof name !== 'string' || !name.includes(' ')) return name;
  return name.replace(/ /g, '-');
}

/**
 * GitHub upload rewrites spaces to dots. Map those published names back to the
 * hyphenated latest.yml / updater URLs.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function hyphenatedWinSetupNameFromGithubDotted(name) {
  if (typeof name !== 'string') return null;
  const m = /^Mesh-client\.Setup\.(\d+\.\d+\.\d+)(-arm64|-x64)?\.exe$/.exec(name);
  if (!m) return null;
  return `Mesh-client-Setup-${m[1]}${m[2] ?? ''}.exe`;
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

/**
 * Rename spaced NSIS Setup exes in place so GitHub asset names match latest.yml.
 *
 * @param {string} rootDir
 * @param {{ version?: string, renameFile?: (from: string, to: string) => void, names?: string[] }} [opts]
 * @returns {{ renamed: Array<{ from: string, to: string }> }}
 */
export function normalizeWinSetupInstallerNames(rootDir, opts = {}) {
  const names = opts.names ?? fs.readdirSync(rootDir);
  const renameFile = opts.renameFile ?? ((from, to) => fs.renameSync(from, to));
  /** @type {Array<{ from: string, to: string }>} */
  const renamed = [];
  for (const name of names) {
    if (!name.includes(' ')) continue;
    if (!name.startsWith('Mesh-client Setup ') || !name.endsWith('.exe')) continue;
    if (name.includes('__uninstaller')) continue;
    const next = hyphenateWinSetupInstallerName(name);
    if (next === name) continue;
    const from = path.join(rootDir, name);
    const to = path.join(rootDir, next);
    if (names.includes(next) || fs.existsSync(to)) {
      throw new Error(`Refusing to overwrite existing file: ${to}`);
    }
    renameFile(from, to);
    renamed.push({ from, to });
  }
  return { renamed };
}
