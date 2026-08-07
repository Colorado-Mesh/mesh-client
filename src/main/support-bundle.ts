import { app } from 'electron';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';

import { buildInfoForManifest, getBuildInfo } from '../shared/buildInfo';
import type { SupportBundleMode } from '../shared/support-bundle.types';
import { exportDatabase } from './database';
import { flushLogBeforeQuit, getLogPath } from './log-service';
import { readUtf8FileBounded } from './reticulum-config-read';
import { sanitizeLogMessage } from './sanitize-log-message';

export type { SupportBundleMode };

const MAX_DEBUG_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
/** Tail-cap for preserved/rotated `mesh-client.log.1` in support zips (full file can be ~100 MB). */
const MAX_SUPPORT_BUNDLE_LOG_BACKUP_BYTES = 10 * 1024 * 1024;
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
    // catch-no-log-ok invalid stack JSON — fail closed; never return raw mnemonic-bearing text
    return JSON.stringify({ error: 'stack_json_redaction_failed' });
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
    } catch (e) {
      // catch-no-log-ok skip oversized or unreadable rnsd config — debug for triage
      const detail = e instanceof Error ? e.message : String(e);
      console.debug(`[support-bundle] skip rnsd config: ${sanitizeLogMessage(detail)}`);
    }
  }

  const stackPath = path.join(root, RETICULUM_STACK_REL);
  if (fs.existsSync(stackPath)) {
    try {
      const redacted = redactMnemonicFromStackJson(readUtf8FileBounded(stackPath));
      artifacts.stackJson = Buffer.from(redacted, 'utf8');
    } catch (e) {
      // catch-no-log-ok skip oversized or unreadable stack state — debug for triage
      const detail = e instanceof Error ? e.message : String(e);
      console.debug(`[support-bundle] skip stack state: ${sanitizeLogMessage(detail)}`);
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
  const stamped = buildInfoForManifest(getBuildInfo());
  const manifest: Record<string, unknown> = {
    kind,
    bundleVersion: 1,
    appVersion:
      typeof app !== 'undefined' && typeof app.getVersion === 'function'
        ? app.getVersion()
        : 'unknown',
    buildChannel: stamped.buildChannel,
    platform: process.platform,
    arch: process.arch,
    packaged:
      typeof app !== 'undefined' && typeof app.isPackaged === 'boolean' ? app.isPackaged : false,
    capturedAt: new Date().toISOString(),
  };
  if (stamped.buildInfo) {
    manifest.buildInfo = stamped.buildInfo;
  }
  const flatpakId = process.env.FLATPAK_ID;
  if (typeof flatpakId === 'string' && flatpakId.length > 0) {
    manifest.flatpakId = flatpakId;
  }
  return manifest;
}

function buildChannelReadmeLine(): string {
  const stamped = buildInfoForManifest(getBuildInfo());
  const runUrl =
    stamped.buildInfo && typeof stamped.buildInfo.runUrl === 'string'
      ? stamped.buildInfo.runUrl
      : undefined;
  if (runUrl) {
    return `Build channel: ${stamped.buildChannel} — CI run: ${runUrl}`;
  }
  return `Build channel: ${stamped.buildChannel}`;
}

function buildReadme(mode: SupportBundleMode): string {
  if (mode === 'github') {
    return `mesh-client support bundle (GitHub report)

This zip is safe to attach to public GitHub issues.

${buildChannelReadmeLine()}

Contents:
  debug-snapshot.json  — UI/session state for triage (Meshtastic, MeshCore, Reticulum sidecar)
  mesh-client.log      — Application log (current session)
  mesh-client.log.1    — Prior session log (preserved on restart) or size-rotated backup
  manifest.json        — App version, buildChannel, and platform metadata
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

${buildChannelReadmeLine()}

Contents:
  debug-snapshot.json           — UI/session state for triage (includes Reticulum sidecar snapshot)
  mesh-client.db                — SQLite database backup (contains secrets)
  reticulum/config              — rnsd interface config (if present)
  reticulum/mesh_client_stack.json — Sidecar stack state, mnemonic redacted (if present)
  reticulum/lxmf-outbound.log   — Filtered LXMF outbound / PN cascade lines from app logs
  mesh-client.log               — Application log (current session)
  mesh-client.log.1             — Prior session log (preserved on restart) or size-rotated backup
  manifest.json                 — App version, buildChannel, and platform metadata
  README.txt                    — This file
`;
}

/** Truncate long hex ids in exported log lines (keep triage prefix only). */
function redactLxmfOutboundLogLine(line: string): string {
  return line.replace(/\b([0-9a-fA-F]{16,})\b/g, (hex) => `${hex.slice(0, 8)}…`);
}

/** Extract LXMF outbound / PN cascade diagnostic lines for developer triage. */
export function extractLxmfOutboundLogSlice(...logChunks: Buffer[]): Buffer {
  const patterns = [
    /lxmf-outbound/i,
    /propagation-deposit/i,
    /LXMF advancing PN cascade/i,
    /LXMF outbound delivery failed/i,
    /Direct path failover/i,
    /PN cascade/i,
    /DeliverPropagated/i,
  ];
  const lines: string[] = [];
  for (const chunk of logChunks) {
    if (!chunk.length) continue;
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (patterns.some((re) => re.test(line))) {
        lines.push(redactLxmfOutboundLogLine(line));
      }
    }
  }
  // Cap slice so huge logs cannot bloat the zip.
  const capped = lines.length > 4000 ? lines.slice(-4000) : lines;
  return Buffer.from(capped.join('\n') + (capped.length ? '\n' : ''), 'utf8');
}

async function readFileOrEmpty(filePath: string): Promise<Buffer> {
  try {
    return await fs.promises.readFile(filePath);
  } catch {
    // catch-no-log-ok missing log file returns empty buffer for bundle export
    return Buffer.alloc(0);
  }
}

/** Read the last `maxBytes` of a file (or the whole file if smaller). */
async function readFileTailOrEmpty(filePath: string, maxBytes: number): Promise<Buffer> {
  try {
    // Open first, then fstat/read via the same handle (avoids CodeQL js/file-system-race TOCTOU).
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const st = await fh.stat();
      if (st.size <= maxBytes) {
        return await fh.readFile();
      }
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, st.size - maxBytes);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    // catch-no-log-ok missing/unreadable backup returns empty buffer for bundle export
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
  const currentLog = await readFileOrEmpty(logPath);
  zip.file('mesh-client.log', currentLog);

  const backupPath = path.join(logDir, LOG_BACKUP_FILENAME);
  let backupLog: Buffer = Buffer.alloc(0);
  if (fs.existsSync(backupPath)) {
    backupLog = await readFileTailOrEmpty(backupPath, MAX_SUPPORT_BUNDLE_LOG_BACKUP_BYTES);
    zip.file(LOG_BACKUP_FILENAME, backupLog);
  }

  zip.file('manifest.json', JSON.stringify(buildManifest(mode), null, 2));
  zip.file('README.txt', buildReadme(mode));

  if (mode === 'developer') {
    const tempRoot = app.getPath('temp');
    await fs.promises.mkdir(tempRoot, { recursive: true });
    const tempDbDir = await fs.promises.mkdtemp(path.join(tempRoot, 'mesh-support-db-'));
    const tempDbPath = path.join(tempDbDir, 'mesh-client.db');
    try {
      exportDatabase(tempDbPath);
      zip.file('mesh-client.db', await fs.promises.readFile(tempDbPath));
    } finally {
      await fs.promises.rm(tempDbDir, { recursive: true, force: true });
    }

    const reticulumArtifacts = readReticulumDeveloperArtifacts();
    if (reticulumArtifacts.config) {
      zip.file('reticulum/config', reticulumArtifacts.config);
    }
    if (reticulumArtifacts.stackJson) {
      zip.file('reticulum/mesh_client_stack.json', reticulumArtifacts.stackJson);
    }
    const lxmfSlice = extractLxmfOutboundLogSlice(backupLog, currentLog);
    if (lxmfSlice.length > 0) {
      zip.file('reticulum/lxmf-outbound.log', lxmfSlice);
    }
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await atomicWriteFile(destZipPath, buf);
}
