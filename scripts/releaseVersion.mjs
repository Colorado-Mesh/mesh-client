/**
 * Release version helpers shared by `release:open` and the release tag plan. Pure string
 * functions: callers read and write the files.
 */
import { previewNextVersion } from './detectReleaseBump.mjs';
import {
  isValidReleaseSemver,
  parseTopReleaseVersion,
  prependMetainfoRelease,
} from './metainfoRelease.mjs';

export const PACKAGE_JSON_PATH = 'package.json';
export const METAINFO_PATH = 'flatpak/org.coloradomesh.MeshClient.metainfo.xml';
export const SCHEMA_SOURCE_PATH = 'src/main/db-schema-sync.ts';

const BUMP_KINDS = new Set(['patch', 'minor', 'major']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** package.json is two-space indented, so only top-level keys sit at exactly two spaces. */
const TOP_LEVEL_VERSION_LINE = /^ {2}"version": "[^"]*"(,?)$/gm;
const SCHEMA_DECLARATION = /^export const CURRENT_SCHEMA_VERSION = (\d+);$/gm;
const FIRST_SELF_CLOSING_RELEASE = /<release\s+version="([^"]*)"[^>]*\/>/;

/**
 * @param {string} version
 * @param {string} label
 */
function assertSemver(version, label) {
  if (!isValidReleaseSemver(version)) {
    throw new Error(`${label} must be X.Y.Z, got ${JSON.stringify(version)}`);
  }
}

/**
 * @param {string} packageJsonText
 * @returns {string}
 */
export function readPackageVersion(packageJsonText) {
  const version = JSON.parse(packageJsonText).version;
  assertSemver(version, 'package.json version');
  return version;
}

/**
 * Rewrite only the top-level `"version"` line, keeping every other byte.
 * @param {string} packageJsonText
 * @param {string} version
 * @returns {string}
 */
export function setPackageVersion(packageJsonText, version) {
  assertSemver(version, 'New version');
  const matches = [...packageJsonText.matchAll(TOP_LEVEL_VERSION_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one top-level "version" line in package.json, found ${matches.length}`,
    );
  }
  return packageJsonText.replace(
    TOP_LEVEL_VERSION_LINE,
    (_line, comma) => `  "version": "${version}"${comma}`,
  );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  assertSemver(a, 'Version');
  assertSemver(b, 'Version');
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

/**
 * @param {{ latestVersion: string, bump: string, detected?: string }} input
 * @returns {string}
 */
export function resolveNextVersion({ latestVersion, bump, detected }) {
  assertSemver(latestVersion, 'Latest released version');
  if (bump === 'none') return latestVersion;
  if (bump === 'auto') {
    if (!detected || !BUMP_KINDS.has(detected)) {
      throw new Error('An auto bump needs a detected kind (patch, minor or major)');
    }
    return previewNextVersion(latestVersion, detected);
  }
  if (BUMP_KINDS.has(bump)) return previewNextVersion(latestVersion, bump);
  if (isValidReleaseSemver(bump)) {
    if (compareVersions(bump, latestVersion) <= 0) {
      throw new Error(`Version ${bump} must be greater than ${latestVersion}`);
    }
    return bump;
  }
  throw new Error(
    `Unknown bump ${JSON.stringify(bump)} (use auto, patch, minor, major, none or X.Y.Z)`,
  );
}

/**
 * The version a new release has to be above. That is the latest release tag, except while a
 * merged release waits for its tag (the Cut release approval is still pending): main's
 * package.json is then already ahead of the tag, and counting from the tag would reuse or lower
 * the waiting version.
 * @param {{ tagVersion: string, mainVersion: string }} input
 * @returns {{ version: string, waiting: boolean }} `waiting` when main's version is ahead of the tag
 */
export function releaseBaseline({ tagVersion, mainVersion }) {
  assertSemver(tagVersion, 'Latest released version');
  assertSemver(mainVersion, "main's package.json version");
  return compareVersions(mainVersion, tagVersion) > 0
    ? { version: mainVersion, waiting: true }
    : { version: tagVersion, waiting: false };
}

/**
 * Put `version` at the top of the MetaInfo `<releases>` list. An unreleased top entry (newer
 * than `latestVersion`, left by an earlier attempt) is replaced rather than stacked.
 * @param {string} xml
 * @param {{ version: string, date: string, latestVersion: string }} release
 * @returns {string}
 */
export function upsertMetainfoRelease(xml, { version, date, latestVersion }) {
  assertSemver(version, 'Release version');
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new Error(`Release date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  }
  const top = parseTopReleaseVersion(xml);
  if (top === version) return xml;
  if (top && isValidReleaseSemver(top) && compareVersions(top, latestVersion) > 0) {
    const element = FIRST_SELF_CLOSING_RELEASE.exec(xml);
    if (!element || element[1] !== top) {
      throw new Error(`Top MetaInfo release ${top} is not a self-closing element; edit it by hand`);
    }
    const replacement = `<release version="${version}" date="${date}"/>`;
    return xml.slice(0, element.index) + replacement + xml.slice(element.index + element[0].length);
  }
  return prependMetainfoRelease(xml, version, date);
}

/**
 * @param {string} source - contents of src/main/db-schema-sync.ts
 * @returns {number}
 */
export function parseSchemaVersion(source) {
  const matches = [...source.matchAll(SCHEMA_DECLARATION)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected one "export const CURRENT_SCHEMA_VERSION = N;" declaration, found ${matches.length}`,
    );
  }
  return Number(matches[0][1]);
}
