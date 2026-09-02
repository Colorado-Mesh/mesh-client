#!/usr/bin/env node
/**
 * Canonical macOS install notice for DMG, GitHub Releases, and release-body text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** Source notice bundled in repo and DMG. */
export const MACOS_INSTALL_NOTICE_SOURCE = path.join(
  projectRoot,
  'resources',
  'macos',
  'IMPORTANT-macOS-install.txt',
);

/** Finder label inside the DMG window. */
export const MACOS_DMG_NOTICE_NAME = 'IMPORTANT-Read-Me.txt';

/** GitHub Releases companion asset (sorts near macOS ZIP downloads). */
export const MACOS_RELEASE_ASSET_NAME = '00-READ-ME-BEFORE-EXTRACTING-macOS-ZIP.txt';

export const MACOS_INSTALL_NOTE_MARKER = '<!-- mesh-client-macos-install -->';

const TROUBLESHOOTING_ANCHOR =
  'https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md#macos-library-not-loaded-squirrelframework-after-zip-extract';

/**
 * @returns {string}
 */
export function readMacosInstallNoticeText() {
  return fs.readFileSync(MACOS_INSTALL_NOTICE_SOURCE, 'utf8');
}

/**
 * Markdown blurb for GitHub Release draft bodies and release.sh copy-paste.
 * @returns {string}
 */
export function formatMacosInstallReleaseMarkdown() {
  return (
    '### macOS install\n\n' +
    '- Requires **macOS 13 Ventura** or later (Electron 44).\n' +
    '- **Recommended:** open the **`.dmg`** and drag **Mesh-client** to **Applications**.\n' +
    '- If you use the **`.zip`**: extract with **[Keka](https://www.keka.io/en/)** or `ditto -xk` — **do not use 7-Zip** (or Finder Archive Utility); they break framework symlinks and can crash at launch with `Library not loaded: Squirrel.framework`.\n' +
    `- See [troubleshooting](${TROUBLESHOOTING_ANCHOR}) if the app will not open after a ZIP extract.`
  );
}

/**
 * @param {string} existingBody
 * @param {string} markdown
 */
export function mergeMacosInstallNoteIntoReleaseBody(existingBody, markdown) {
  const note = `${MACOS_INSTALL_NOTE_MARKER}\n${markdown.trim()}\n${MACOS_INSTALL_NOTE_MARKER}`;
  const without = existingBody.replace(
    new RegExp(`${MACOS_INSTALL_NOTE_MARKER}[\\s\\S]*?${MACOS_INSTALL_NOTE_MARKER}\\n?`, 'g'),
    '',
  );
  const rest = without.trim();
  return rest ? `${note}\n\n${rest}\n` : `${note}\n`;
}

/**
 * Copy the canonical notice into release/ for GitHub upload.
 * @param {string} [releaseDir]
 * @returns {string} absolute path to staged asset
 */
export function stageMacosInstallNoticeReleaseAsset(
  releaseDir = path.join(projectRoot, 'release'),
) {
  fs.mkdirSync(releaseDir, { recursive: true });
  const dest = path.join(releaseDir, MACOS_RELEASE_ASSET_NAME);
  fs.copyFileSync(MACOS_INSTALL_NOTICE_SOURCE, dest);
  return dest;
}
