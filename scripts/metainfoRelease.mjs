/**
 * Flatpak MetaInfo <release> helpers for release.sh and check-flatpak.
 * Keep version strings validated — never trust `pnpm version` stdout.
 */

export const RELEASE_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * @param {unknown} version
 * @returns {version is string}
 */
export function isValidReleaseSemver(version) {
  return typeof version === 'string' && RELEASE_SEMVER_PATTERN.test(version);
}

/**
 * @param {string} xml
 * @returns {string | null}
 */
export function parseTopReleaseVersion(xml) {
  const m = xml.match(/<release\s+version="([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * Recovery copy when MetaInfo top <release> does not match package.json.
 * Never suggests re-running a full `pnpm run release` (that would bump again).
 *
 * @param {string} topVersion
 * @param {string} pkgVersion
 * @returns {string}
 */
export function metainfoVersionMismatchMessage(topVersion, pkgVersion) {
  const corrupt = !isValidReleaseSemver(topVersion) || /[\r\n]/.test(topVersion);
  const shown = corrupt ? `(invalid/non-semver: ${JSON.stringify(topVersion)})` : `"${topVersion}"`;
  const lines = [
    `top <release version=${shown}> does not match package.json version "${pkgVersion}"`,
    'Do NOT re-run `pnpm run release` — that would bump the version again.',
    `1. Set the top <release version="…"> in flatpak/org.coloradomesh.MeshClient.metainfo.xml to "${pkgVersion}"`,
    '2. If package.json was already bumped mid-release, complete with: pnpm run release --finish',
  ];
  return lines.join(' — ');
}

/**
 * @param {string} xml
 * @param {string} version
 * @param {string} date YYYY-MM-DD
 * @returns {string}
 */
export function prependMetainfoRelease(xml, version, date) {
  if (!isValidReleaseSemver(version)) {
    throw new Error(
      `Refusing to write MetaInfo release: version must be X.Y.Z, got ${JSON.stringify(version)}`,
    );
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `Refusing to write MetaInfo release: date must be YYYY-MM-DD, got ${JSON.stringify(date)}`,
    );
  }
  if (!xml.includes('<releases>')) {
    throw new Error('MetaInfo XML is missing <releases>');
  }
  const top = parseTopReleaseVersion(xml);
  if (top === version) {
    return xml;
  }
  return xml.replace(
    '<releases>',
    `<releases>\n    <release version="${version}" date="${date}"/>`,
  );
}
