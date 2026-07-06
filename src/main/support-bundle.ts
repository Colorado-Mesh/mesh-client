import { app } from 'electron';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';

import type { SupportBundleMode } from '../shared/support-bundle.types';
import { exportDatabase } from './database';
import { flushLogBeforeQuit, getLogPath } from './log-service';
import { readUtf8FileBounded } from './reticulum-config-read';

export type { SupportBundleMode };

const MAX_DEBUG_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
const LOG_BACKUP_FILENAME = 'mesh-client.log.1';
const RETICULUM_CONFIG_REL = path.join('config', 'config');
const RETICULUM_STACK_REL = path.join('storage', 'mesh_client_stack.json');

export interface ReticulumDeveloperArtifacts {
  config?: Buffer;
  stackJson?: Buffer;
}

/** Strip identity mnemonic from stack JSON before developer bundle export (defense in depth). */
export function redactMnemonicFromStackJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const identity = parsed.identity;
    if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
      const identityObj = identity as Record<string, unknown>;
      if ('mnemonic' in identityObj) {
        delete identityObj.mnemonic;
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    // catch-no-log-ok invalid stack JSON — return raw for maintainer triage
    return raw;
  }
}

function reticulumUserDataDir(): string {
  return path.join(app.getPath('userData'), 'reticulum');
}

/** Read bounded Reticulum sidecar files for developer-only support bundles. */
export function readReticulumDeveloperArtifacts(): ReticulumDeveloperArtifacts {
  const root = reticulumUserDataDir();
  const artifacts: ReticulumDeveloperArtifacts = {};

  const configPath = path.join(root, RETICULUM_CONFIG_REL);
  if (fs.existsSync(configPath)) {
    try {
      artifacts.config = Buffer.from(readUtf8FileBounded(configPath), 'utf8');
    } catch {
      // catch-no-log-ok skip oversized or unreadable rnsd config
    }
  }

  const stackPath = path.join(root, RETICULUM_STACK_REL);
  if (fs.existsSync(stackPath)) {
    try {
      const redacted = redactMnemonicFromStackJson(readUtf8FileBounded(stackPath));
      artifacts.stackJson = Buffer.from(redacted, 'utf8');
    } catch {
      // catch-no-log-ok skip oversized or unreadable stack state
    }
  }

  return artifacts;
}

export function validateDebugSnapshotJson(debugSnapshotJson: string): Record<string, unknown> {
  if (debugSnapshotJson.length > MAX_DEBUG_SNAPSHOT_JSON_BYTES) {
    throw new Error('debug snapshot JSON too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(debugSnapshotJson);
  } catch {
    throw new Error('debug snapshot JSON is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('debug snapshot JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

function buildManifest(mode: SupportBundleMode): Record<string, unknown> {
  const kind = mode === 'github' ? 'mesh-client-github-report' : 'mesh-client-developer-bundle';
  const manifest: Record<string, unknown> = {
    kind,
    bundleVersion: 1,
    appVersion:
      typeof app !== 'undefined' && typeof app.getVersion === 'function'
        ? app.getVersion()
        : 'unknown',
    platform: process.platform,
    arch: process.arch,
    packaged:
      typeof app !== 'undefined' && typeof app.isPackaged === 'boolean' ? app.isPackaged : false,
    capturedAt: new Date().toISOString(),
  };
  const flatpakId = process.env.FLATPAK_ID;
  if (typeof flatpakId === 'string' && flatpakId.length > 0) {
    manifest.flatpakId = flatpakId;
  }
  return manifest;
}

function buildReadme(mode: SupportBundleMode): string {
  if (mode === 'github') {
    return `mesh-client support bundle (GitHub report)

This zip is safe to attach to public GitHub issues.

Contents:
  debug-snapshot.json  — UI/session state for triage (Meshtastic, MeshCore, Reticulum sidecar)
  mesh-client.log      — Application log (current session)
  mesh-client.log.1    — Rotated log backup (if present)
  manifest.json        — App version and platform metadata
  README.txt           — This file

Reticulum sidecar health, interface audit, and identity hashes are in debug-snapshot.json
when the stack was running at export time. [ReticulumSidecar] lines appear in the logs.

For deeper triage that requires your local database or rnsd config, a maintainer may ask you to
export "Export for Developer" separately and share it via a private channel only.
`;
  }

  return `mesh-client support bundle (Developer)

PRIVATE USE ONLY — do not attach this zip or mesh-client.db to public GitHub issues.

The database may contain saved passwords (MeshCore room/repeater credentials, MQTT
settings, and similar secrets). Share this bundle only with maintainers via a
private channel (email, Discord DM, etc.) when they request it.

Contents:
  debug-snapshot.json           — UI/session state for triage (includes Reticulum sidecar snapshot)
  mesh-client.db                — SQLite database backup (contains secrets)
  reticulum/config              — rnsd interface config (if present)
  reticulum/mesh_client_stack.json — Sidecar stack state, mnemonic redacted (if present)
  mesh-client.log               — Application log (current session)
  mesh-client.log.1             — Rotated log backup (if present)
  manifest.json                 — App version and platform metadata
  README.txt                    — This file
`;
}

async function readFileOrEmpty(filePath: string): Promise<Buffer> {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    // catch-no-log-ok missing log file returns empty buffer for bundle export
    return Buffer.alloc(0);
  }
}

async function atomicWriteFile(destPath: string, data: Buffer): Promise<void> {
  const tmpPath = `${destPath}.tmp`;
  await fs.promises.writeFile(tmpPath, data);
  try {
    if (process.platform === 'win32' && fs.existsSync(destPath)) {
      await fs.promises.rm(destPath, { force: true });
    }
    await fs.promises.rename(tmpPath, destPath);
  } catch (err) {
    try {
      await fs.promises.rm(tmpPath, { force: true });
    } catch {
      // catch-no-log-ok best-effort cleanup after failed rename
    }
    throw err;
  }
}

export function defaultSupportBundleFilename(mode: SupportBundleMode): string {
  const date = new Date().toISOString().slice(0, 10);
  return mode === 'github'
    ? `mesh-client-github-report-${date}.zip`
    : `mesh-client-developer-bundle-${date}.zip`;
}

export function isSupportBundleMode(value: unknown): value is SupportBundleMode {
  return value === 'github' || value === 'developer';
}

/** Build a support zip at destZipPath. Failure point: disk I/O or DB backup; throws on error. */
export async function buildSupportBundleZip(
  destZipPath: string,
  mode: SupportBundleMode,
  debugSnapshotJson: string,
): Promise<void> {
  validateDebugSnapshotJson(debugSnapshotJson);
  await flushLogBeforeQuit();

  const zip = new JSZip();
  zip.file('debug-snapshot.json', debugSnapshotJson);

  const logPath = getLogPath();
  const logDir = path.dirname(logPath);
  zip.file('mesh-client.log', await readFileOrEmpty(logPath));

  const backupPath = path.join(logDir, LOG_BACKUP_FILENAME);
  if (fs.existsSync(backupPath)) {
    zip.file(LOG_BACKUP_FILENAME, await fs.promises.readFile(backupPath));
  }

  zip.file('manifest.json', JSON.stringify(buildManifest(mode), null, 2));
  zip.file('README.txt', buildReadme(mode));

  if (mode === 'developer') {
    const tempDbPath = path.join(app.getPath('temp'), `mesh-client-support-db-${Date.now()}.db`);
    try {
      exportDatabase(tempDbPath);
      zip.file('mesh-client.db', await fs.promises.readFile(tempDbPath));
    } finally {
      await fs.promises.rm(tempDbPath, { force: true });
    }

    const reticulumArtifacts = readReticulumDeveloperArtifacts();
    if (reticulumArtifacts.config) {
      zip.file('reticulum/config', reticulumArtifacts.config);
    }
    if (reticulumArtifacts.stackJson) {
      zip.file('reticulum/mesh_client_stack.json', reticulumArtifacts.stackJson);
    }
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await atomicWriteFile(destZipPath, buf);
}
