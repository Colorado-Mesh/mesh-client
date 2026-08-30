#!/usr/bin/env node
/**
 * Stage macOS ZIP install notice into release/ for dist:mac and CI upload.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MACOS_RELEASE_ASSET_NAME,
  stageMacosInstallNoticeReleaseAsset,
} from './macos-install-notice.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const dest = stageMacosInstallNoticeReleaseAsset(releaseDir);
console.debug(`[stage-macos-install-notice] Wrote ${MACOS_RELEASE_ASSET_NAME} -> ${dest}`);
