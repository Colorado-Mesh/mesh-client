import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { WebContents } from 'electron';
import { BrowserWindow } from 'electron';

import {
  ENV_FORCE_FILE_ORIGIN,
  ENV_FORCE_ORIGIN_REPAIR,
  ENV_SKIP_ORIGIN_MIGRATION,
  isCriticalRendererStorageKey,
  LATEST_RENDERER_ORIGIN_MIGRATION,
  RENDERER_MIGRATION_URL,
  RENDERER_ORIGIN_EXPORT_FORMAT_VERSION,
  RENDERER_STORAGE_DELETION_PREFIX,
} from '../shared/rendererOrigin';
import {
  hasEstablishedRendererPreferenceValues,
  isExplicitResetPreferenceBaseline,
  isRendererPreferenceKey,
  parseRendererPreferenceValues,
} from '../shared/rendererPreferences';
import {
  hasAppliedRendererStorageIntent,
  parseRendererStorageIntent,
  type PendingRendererStorageIntent,
  type RendererStorageDeletionState,
} from '../shared/rendererStorageIntent';
import { MS_PER_SECOND } from '../shared/timeConstants';
import { normalizeDevServerUrl } from './resolveRendererLoadUrl';
import { sanitizeLogMessage } from './sanitize-log-message';

export type WebStorageEntries = Record<string, string>;
export type RendererOriginMigrationResult = 'completed' | 'skipped' | 'failed';
export type RendererOriginHealthResult = 'healthy' | 'repaired' | 'failed';

export interface WebStorageOriginMigrationOptions {
  devServerUrl?: string;
  userDataPath: string;
  legacyMigrationUrl: string;
  appVersion: string;
  env?: NodeJS.ProcessEnv;
  seedDurableStorage: (entries: WebStorageEntries) => void | Promise<void>;
  commitImportedStorageIntents: (
    intents: Readonly<Record<string, PendingRendererStorageIntent>>,
  ) => void | Promise<void>;
  timeoutMs?: number;
  readStorageDeletionStates?: () => Readonly<Record<string, RendererStorageDeletionState>>;
  /** Stop application writers before post-load repair takes a fresh inert-origin snapshot. */
  unloadRendererBeforeRepair?: () => Promise<void>;
}

interface StorageExport {
  formatVersion: number;
  capturedAt: string;
  appVersion: string;
  keyCount: number;
  sha256: string;
  entries: WebStorageEntries;
}

type MigrationPhase =
  'pending' | 'exported' | 'imported' | 'verified' | 'completed' | 'needsRepair';

interface MigrationState {
  formatVersion: number;
  phase: MigrationPhase;
  updatedAt: string;
  exportSha256?: string;
  completedVersion?: number;
  // Retained after demotion so retries never overwrite newer custom-origin values with legacy ones.
  hasCompleted: boolean;
}

export const RENDERER_ORIGIN_STATE_FILENAME = 'renderer-origin-migration.json';
export const LEGACY_STORAGE_EXPORT_FILENAME = 'legacy-file-origin-web-storage-v1.json';
export const RENDERER_ORIGIN_STORAGE_SENTINEL_KEY = 'mesh-client:renderer-origin-migration';
export const RENDERER_STORAGE_RESET_FILENAME = 'renderer-storage-reset.json';
const MIGRATION_TIMEOUT_MS = 15 * MS_PER_SECOND;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

export interface RendererStorageResetOptions {
  userDataPath: string;
  appVersion: string;
  clearSessionStorage: () => Promise<void>;
  resetDurableStorage: () => void | Promise<void>;
}

interface StorageReset {
  formatVersion: 1;
  phase: 'pending' | 'completed';
}

// No application scripts or preload run on migration.html. Transfer data, never executable source.
const READ_STORAGE_SCRIPT = `(() => {
  const entries = Object.create(null);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) entries[key] = localStorage.getItem(key);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(entries));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
})()`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEntries(value: unknown): WebStorageEntries {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    throw new Error('Invalid localStorage snapshot entries');
  }
  return value as WebStorageEntries;
}

function storageDigest(entries: WebStorageEntries): string {
  const sorted = Object.keys(entries)
    .sort()
    .map((key) => [key, entries[key]]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function migrationPath(options: { userDataPath: string }, filename: string): string {
  return path.join(options.userDataPath, 'migration', filename);
}

/** Flush a restricted temporary file before atomic rename; retain the previous file on failure. */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    // OS-specific: Windows cannot open directories for fsync. The file is flushed on every OS.
    if (process.platform !== 'win32') {
      const directory = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function readJsonIfPresent(filePath: string): unknown {
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, 'r');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    // Check and read the same open file even if its pathname is replaced during migration.
    if (fs.fstatSync(descriptor).size > MAX_EXPORT_BYTES) {
      throw new Error('Renderer origin migration file exceeds size limit');
    }
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const chunks: Buffer[] = [];
    let total = 0;
    // Read one extra byte to detect growth past the cap after fstat, including short reads.
    while (total <= MAX_EXPORT_BYTES) {
      const bytesRead = fs.readSync(descriptor, buffer, {
        offset: 0,
        length: Math.min(buffer.length, MAX_EXPORT_BYTES - total + 1),
        position: total,
      });
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_EXPORT_BYTES) {
        throw new Error('Renderer origin migration file exceeds size limit');
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } finally {
    fs.closeSync(descriptor);
  }
}

function readStorageReset(options: { userDataPath: string }): StorageReset | undefined {
  const value = readJsonIfPresent(migrationPath(options, RENDERER_STORAGE_RESET_FILENAME));
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    (value.phase !== 'pending' && value.phase !== 'completed')
  ) {
    throw new Error('Invalid or unsupported renderer storage reset');
  }
  return value as unknown as StorageReset;
}

/** Record explicit deletion before clearing either origin or its durable recovery copies. */
export function beginRendererStorageReset(options: { userDataPath: string }): void {
  readStorageReset(options);
  writeJsonAtomic(migrationPath(options, RENDERER_STORAGE_RESET_FILENAME), {
    formatVersion: 1,
    phase: 'pending',
  } satisfies StorageReset);
}

/** Run before loading any renderer, including development and forced file-origin recovery. */
export async function resumePendingRendererStorageReset(
  options: RendererStorageResetOptions,
): Promise<void> {
  if (readStorageReset(options)?.phase !== 'pending') return;
  await options.clearSessionStorage();
  await options.resetDurableStorage();
  const entries = {};
  const snapshot: StorageExport = {
    formatVersion: RENDERER_ORIGIN_EXPORT_FORMAT_VERSION,
    capturedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    keyCount: 0,
    sha256: storageDigest(entries),
    entries,
  };
  // Explicit Clear All Local Data is the only operation that replaces the recovery baseline.
  // Keep the intent pending until both artifacts are durable so every interruption retries clear.
  writeJsonAtomic(migrationPath(options, LEGACY_STORAGE_EXPORT_FILENAME), snapshot);
  saveState(options, 'pending', snapshot, false);
  writeJsonAtomic(migrationPath(options, RENDERER_STORAGE_RESET_FILENAME), {
    formatVersion: 1,
    phase: 'completed',
  } satisfies StorageReset);
}

function assertStorageResetCompleted(options: { userDataPath: string }): void {
  if (readStorageReset(options)?.phase === 'pending') {
    throw new Error('Renderer storage reset must finish before migration or repair');
  }
}

function readStorageExport(options: WebStorageOriginMigrationOptions): StorageExport | undefined {
  const value = readJsonIfPresent(migrationPath(options, LEGACY_STORAGE_EXPORT_FILENAME));
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    value.formatVersion !== RENDERER_ORIGIN_EXPORT_FORMAT_VERSION ||
    typeof value.capturedAt !== 'string' ||
    typeof value.appVersion !== 'string'
  ) {
    throw new Error('Invalid renderer origin recovery export');
  }
  const entries = parseEntries(value.entries);
  if (value.keyCount !== Object.keys(entries).length || value.sha256 !== storageDigest(entries)) {
    throw new Error('Renderer origin recovery export checksum mismatch');
  }
  return value as unknown as StorageExport;
}

function readState(options: WebStorageOriginMigrationOptions): MigrationState | undefined {
  const value = readJsonIfPresent(migrationPath(options, RENDERER_ORIGIN_STATE_FILENAME));
  if (value === undefined) return undefined;
  const phases: MigrationPhase[] = [
    'pending',
    'exported',
    'imported',
    'verified',
    'completed',
    'needsRepair',
  ];
  if (
    !isRecord(value) ||
    value.formatVersion !== RENDERER_ORIGIN_EXPORT_FORMAT_VERSION ||
    !phases.includes(value.phase as MigrationPhase) ||
    typeof value.updatedAt !== 'string' ||
    typeof value.hasCompleted !== 'boolean' ||
    (value.exportSha256 !== undefined && typeof value.exportSha256 !== 'string') ||
    (value.completedVersion !== undefined &&
      value.completedVersion !== LATEST_RENDERER_ORIGIN_MIGRATION) ||
    (value.phase === 'completed' &&
      (value.completedVersion !== LATEST_RENDERER_ORIGIN_MIGRATION || !value.hasCompleted))
  ) {
    throw new Error('Invalid or unsupported renderer origin migration state');
  }
  return value as unknown as MigrationState;
}

function saveState(
  options: { userDataPath: string },
  phase: MigrationPhase,
  snapshot: StorageExport | undefined,
  hasCompleted: boolean,
): void {
  const state: MigrationState = {
    formatVersion: RENDERER_ORIGIN_EXPORT_FORMAT_VERSION,
    phase,
    updatedAt: new Date().toISOString(),
    hasCompleted,
    ...(snapshot ? { exportSha256: snapshot.sha256 } : {}),
    ...(phase === 'completed' ? { completedVersion: LATEST_RENDERER_ORIGIN_MIGRATION } : {}),
  };
  writeJsonAtomic(migrationPath(options, RENDERER_ORIGIN_STATE_FILENAME), state);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Renderer origin storage operation timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function inStorageWindow<T>(
  url: string,
  options: WebStorageOriginMigrationOptions,
  operation: (contents: WebContents) => Promise<T>,
): Promise<T> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      // No partition/session override: migration and the main window share the default session.
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  try {
    return await withTimeout(
      (async () => {
        await window.loadURL(url);
        if (window.isDestroyed()) throw new Error('Renderer origin storage window closed');
        return operation(window.webContents);
      })(),
      options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function readStorage(
  contents: Pick<WebContents, 'executeJavaScript'>,
): Promise<WebStorageEntries> {
  const encoded: unknown = await contents.executeJavaScript(READ_STORAGE_SCRIPT);
  if (typeof encoded !== 'string' || encoded.length > MAX_EXPORT_BYTES) {
    throw new Error('Invalid encoded localStorage snapshot');
  }
  return parseEntries(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown);
}

function readTarget(options: WebStorageOriginMigrationOptions): Promise<WebStorageEntries> {
  return inStorageWindow(RENDERER_MIGRATION_URL, options, readStorage);
}

/** Keep recovery exports intact while excluding their historical control journal. */
function withoutDeletionJournal(entries: WebStorageEntries, historical = false): WebStorageEntries {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([key]) =>
        !key.startsWith(RENDERER_STORAGE_DELETION_PREFIX) &&
        !(
          historical &&
          (key.startsWith('mesh-client:durablePending:') || key === 'mesh-client:incidentPending')
        ),
    ),
  );
}

/**
 * Keep the canonical preference map aligned with top-level preference caches during repair.
 * An empty clear() envelope is rebuilt entirely. An established map that lost export-only keys
 * after clear()+write-through still receives those top-level keys so finalize cannot drop them.
 */
function withRebuiltPreferenceMap(entries: WebStorageEntries): WebStorageEntries {
  const prefsRaw = entries['mesh-client:rendererPreferences'];
  if (isExplicitResetPreferenceBaseline(prefsRaw)) return entries;
  const topLevel = Object.fromEntries(
    Object.entries(entries).filter(([key]) => isRendererPreferenceKey(key)),
  );
  const existingValues = parseRendererPreferenceValues(prefsRaw) ?? {};
  // Map-only keys survive; top-level caches fill gaps and win on conflict.
  const values = { ...existingValues, ...topLevel };
  if (Object.keys(values).length === 0) return entries;
  const next = JSON.stringify({ legacyAliasesImported: true, values });
  if (prefsRaw === next) return entries;
  return {
    ...entries,
    'mesh-client:rendererPreferences': next,
  };
}

/** Before the canonical map exists, a partial app blob must not hide recoverable fields. */
function recoverMissingAppFields(
  retained: WebStorageEntries,
  current: WebStorageEntries,
): WebStorageEntries {
  if (hasEstablishedRendererPreferenceValues(current['mesh-client:rendererPreferences'])) {
    return current;
  }
  const result = { ...current };
  for (const key of ['mesh-client:appSettings', 'mesh-client:adminSettings']) {
    if (retained[key] === undefined || current[key] === undefined) continue;
    try {
      const original: unknown = JSON.parse(retained[key]);
      const latest: unknown = JSON.parse(current[key]);
      if (
        original !== null &&
        typeof original === 'object' &&
        !Array.isArray(original) &&
        latest !== null &&
        typeof latest === 'object' &&
        !Array.isArray(latest) &&
        Object.keys(original).some((field) => !Object.hasOwn(latest, field))
      ) {
        result[key] = JSON.stringify({ ...original, ...latest });
      }
    } catch {
      // catch-no-log-ok keep malformed originals intact for the startup recovery surface
    }
  }
  return result;
}

async function importAndVerify(
  options: WebStorageOriginMigrationOptions,
  snapshot: StorageExport,
  entries: WebStorageEntries,
  hasCompleted: boolean,
): Promise<void> {
  const deleted = deletedStorageKeys(options, entries);
  const retained = Object.fromEntries(Object.entries(entries).filter(([key]) => !deleted.has(key)));
  await withTimeout(
    Promise.resolve(options.seedDurableStorage(retained)),
    options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
  );
  const expected = {
    ...retained,
    [RENDERER_ORIGIN_STORAGE_SENTINEL_KEY]: storageSentinel(snapshot),
  };
  const encoded = Buffer.from(JSON.stringify(expected), 'utf8').toString('base64');
  const encodedDeletions = Buffer.from(JSON.stringify([...deleted]), 'utf8').toString('base64');
  await inStorageWindow(RENDERER_MIGRATION_URL, options, async (contents) => {
    await contents.executeJavaScript(`(() => {
      const bytes = Uint8Array.from(atob('${encoded}'), character => character.charCodeAt(0));
      const entries = JSON.parse(new TextDecoder().decode(bytes));
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (key !== null && key.startsWith('${RENDERER_STORAGE_DELETION_PREFIX}') && !Object.hasOwn(entries, key)) localStorage.removeItem(key);
      }
      const deletions = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${encodedDeletions}'), character => character.charCodeAt(0))));
      for (const key of deletions) localStorage.removeItem(key);
      // clear() write-through may leave an empty or incomplete preference envelope. Remove it
      // (unless it is an explicit-reset baseline) so the repaired map can be written when
      // hasCompleted otherwise refuses to overwrite surviving keys.
      const prefsKey = 'mesh-client:rendererPreferences';
      const expectedPrefs = entries[prefsKey];
      const prefsRaw = localStorage.getItem(prefsKey);
      if (
        typeof expectedPrefs === 'string' &&
        prefsRaw !== null &&
        prefsRaw !== expectedPrefs
      ) {
        try {
          const parsed = JSON.parse(prefsRaw);
          const baseline =
            parsed &&
            typeof parsed === 'object' &&
            parsed.resetBaseline === true &&
            parsed.values &&
            typeof parsed.values === 'object' &&
            !Array.isArray(parsed.values) &&
            Object.keys(parsed.values).length === 0;
          if (!baseline) localStorage.removeItem(prefsKey);
        } catch {
          // catch-no-log-ok malformed preference envelopes are replaced by the set loop
          localStorage.removeItem(prefsKey);
        }
      }
      for (const [key, value] of Object.entries(entries)) {
        if (${hasCompleted} && (key === 'mesh-client:appSettings' || key === 'mesh-client:adminSettings') && localStorage.getItem(key) !== null && localStorage.getItem(key) !== value) {
          const restored = JSON.parse(value), current = JSON.parse(localStorage.getItem(key));
          if (restored && current && typeof restored === 'object' && typeof current === 'object' && !Array.isArray(restored) && !Array.isArray(current)) {
            localStorage.setItem(key, JSON.stringify({ ...restored, ...current }));
            continue;
          }
        }
        if (${hasCompleted ? `key === '${RENDERER_ORIGIN_STORAGE_SENTINEL_KEY}' || localStorage.getItem(key) === null` : 'true'}) localStorage.setItem(key, value);
      }
    })()`);
    contents.session.flushStorageData();
  });
  saveState(options, 'imported', snapshot, hasCompleted);
  // A new window must see the entire import. A resolved setItem loop is not completion evidence.
  const actual = await readTarget(options);
  if (storageDigest(actual) !== storageDigest(expected)) {
    throw new Error('Renderer origin localStorage read-back verification failed');
  }
  saveState(options, 'verified', snapshot, hasCompleted);
  saveState(options, 'completed', snapshot, true);
}

function storageSentinel(snapshot: StorageExport): string {
  return JSON.stringify({
    version: LATEST_RENDERER_ORIGIN_MIGRATION,
    exportSha256: snapshot.sha256,
  });
}

function deletedStorageKeys(
  options: WebStorageOriginMigrationOptions,
  entries: WebStorageEntries,
): Set<string> {
  const states = options.readStorageDeletionStates?.() ?? {};
  const deleted = new Set(
    Object.entries(states)
      .filter(([, state]) => state.deleted)
      .map(([key]) => key),
  );
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(RENDERER_STORAGE_DELETION_PREFIX)) continue;
    const original = key.slice(RENDERER_STORAGE_DELETION_PREFIX.length);
    const intent = parseRendererStorageIntent(value);
    // A retained/copy journal can outlive its acknowledgement and a newer change on
    // another origin. Only an intent without a matching receipt may override SQLite.
    const state = states[original];
    if (state && hasAppliedRendererStorageIntent(state, intent)) continue;
    if (intent.deleted) deleted.add(original);
    else deleted.delete(original);
  }
  return deleted;
}

function storageHealthy(
  options: WebStorageOriginMigrationOptions,
  snapshot: StorageExport,
  entries: WebStorageEntries,
): boolean {
  if (entries[RENDERER_ORIGIN_STORAGE_SENTINEL_KEY] !== storageSentinel(snapshot)) return false;
  const deleted = deletedStorageKeys(options, entries);
  if ([...deleted].some((key) => Object.hasOwn(entries, key))) return false;
  // Once the renderer has established a nonempty canonical preference map, missing individual
  // caches (including intentional removals) are reconciled from SQLite before App mounts.
  // An empty map (e.g. after localStorage.clear write-through) must not skip export repair.
  const preferencesBackedUp = hasEstablishedRendererPreferenceValues(
    entries['mesh-client:rendererPreferences'],
  );
  const recovered = recoverMissingAppFields(snapshot.entries, entries);
  if (
    recovered['mesh-client:appSettings'] !== entries['mesh-client:appSettings'] ||
    recovered['mesh-client:adminSettings'] !== entries['mesh-client:adminSettings']
  )
    return false;
  return Object.keys(snapshot.entries).every(
    (key) =>
      !isCriticalRendererStorageKey(key) ||
      Object.hasOwn(entries, key) ||
      deleted.has(key) ||
      (preferencesBackedUp && isRendererPreferenceKey(key)),
  );
}

function requireCompletedExport(
  state: MigrationState,
  snapshot: StorageExport | undefined,
): asserts snapshot is StorageExport {
  if (!snapshot || state.exportSha256 !== snapshot.sha256) {
    throw new Error('Completed renderer origin migration has no matching recovery export');
  }
}

async function repairStorage(
  options: WebStorageOriginMigrationOptions,
  snapshot: StorageExport,
  current: WebStorageEntries,
): Promise<void> {
  saveState(options, 'needsRepair', snapshot, true);
  // Legitimate changes (including emptied persist envelopes) always beat the old export.
  const deleted = deletedStorageKeys(options, current);
  // Only current-origin pending intents may override SQLite after the first cutover.
  const retained = Object.fromEntries(
    Object.entries(withoutDeletionJournal(snapshot.entries, true)).filter(
      ([key]) => !deleted.has(key),
    ),
  );
  const retainedCurrent = Object.fromEntries(
    Object.entries(current).filter(([key]) => !deleted.has(key)),
  );
  const merged = withRebuiltPreferenceMap(
    recoverMissingAppFields(retained, { ...retained, ...retainedCurrent }),
  );
  await importAndVerify(options, snapshot, merged, true);
}

async function reverifyExistingStorage(
  options: WebStorageOriginMigrationOptions,
  snapshot: StorageExport,
  current: WebStorageEntries,
): Promise<void> {
  saveState(options, 'needsRepair', snapshot, true);
  // A surviving valid marker permits user deletions. Re-earn state without restoring old keys.
  await importAndVerify(options, snapshot, current, true);
}

function reportFailure(error: unknown): void {
  console.warn(
    '[Startup] Renderer origin migration/health check failed; retaining file origin:',
    sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
  );
}

/** Return completed only after a verified copy or a healthy previously completed copy. */
export async function runWebStorageOriginMigration(
  options: WebStorageOriginMigrationOptions,
): Promise<RendererOriginMigrationResult> {
  const env = options.env ?? process.env;
  if (
    normalizeDevServerUrl(options.devServerUrl) ||
    env[ENV_FORCE_FILE_ORIGIN] === '1' ||
    env[ENV_SKIP_ORIGIN_MIGRATION] === '1'
  ) {
    return 'skipped';
  }
  let state: MigrationState | undefined;
  let snapshot: StorageExport | undefined;
  try {
    assertStorageResetCompleted(options);
    state = readState(options);
    snapshot = readStorageExport(options);
    if (state?.hasCompleted) {
      requireCompletedExport(state, snapshot);
      const current = await readTarget(options);
      if (env[ENV_FORCE_ORIGIN_REPAIR] !== '1' && storageHealthy(options, snapshot, current)) {
        if (state.phase !== 'completed') await reverifyExistingStorage(options, snapshot, current);
        else
          await withTimeout(
            Promise.resolve(options.seedDurableStorage(current)),
            options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
          );
        return 'completed';
      }
      await repairStorage(options, snapshot, current);
      return 'completed';
    }

    // A missing state file does not make surviving custom-origin user data disposable.
    // A matching marker/export can re-earn completion through a full verification. Missing or
    // mismatched recovery evidence must fail before creating a replacement state file.
    const untrackedCurrent = state === undefined ? await readTarget(options) : undefined;
    if (untrackedCurrent && Object.hasOwn(untrackedCurrent, RENDERER_ORIGIN_STORAGE_SENTINEL_KEY)) {
      if (!snapshot || !storageHealthy(options, snapshot, untrackedCurrent)) {
        throw new Error('Untracked renderer origin has no matching recovery export');
      }
      if (env[ENV_FORCE_ORIGIN_REPAIR] === '1') {
        await repairStorage(options, snapshot, untrackedCurrent);
      } else {
        await reverifyExistingStorage(options, snapshot, untrackedCurrent);
      }
      return 'completed';
    }

    const untracked = untrackedCurrent && Object.keys(untrackedCurrent).length > 0;
    if (untracked && snapshot) {
      await repairStorage(options, snapshot, untrackedCurrent);
      return 'completed';
    }

    // Preserve the untracked origin across interruptions: write its legacy recovery export
    // first, then repairStorage records hasCompleted before any target writes can occur.
    if (!untracked) saveState(options, 'pending', snapshot, false);
    let entries: WebStorageEntries;
    let liveLegacyEntries: WebStorageEntries | undefined;
    try {
      entries = await inStorageWindow(options.legacyMigrationUrl, options, readStorage);
      liveLegacyEntries = entries;
    } catch (error) {
      if (!snapshot) throw error;
      console.warn(
        '[Startup] Renderer origin legacy storage unavailable; resuming from the saved recovery export',
      );
      entries = snapshot.entries;
    }
    if (snapshot) {
      entries = recoverMissingAppFields(snapshot.entries, entries);
      if (liveLegacyEntries)
        liveLegacyEntries = recoverMissingAppFields(snapshot.entries, liveLegacyEntries);
    }
    if (
      snapshot &&
      (Object.keys(entries).length < snapshot.keyCount ||
        Object.keys(snapshot.entries).some((key) => !Object.hasOwn(entries, key)))
    ) {
      console.warn(
        '[Startup] Renderer origin keeping the existing recovery export; legacy snapshot lost keys',
      );
    } else {
      snapshot = {
        formatVersion: RENDERER_ORIGIN_EXPORT_FORMAT_VERSION,
        capturedAt: new Date().toISOString(),
        appVersion: options.appVersion,
        keyCount: Object.keys(entries).length,
        sha256: storageDigest(entries),
        entries,
      };
      writeJsonAtomic(migrationPath(options, LEGACY_STORAGE_EXPORT_FILENAME), snapshot);
    }
    if (untracked) {
      await repairStorage(options, snapshot, untrackedCurrent);
      return 'completed';
    }
    saveState(options, 'exported', snapshot, false);
    const importedIntents = Object.fromEntries(
      Object.entries(liveLegacyEntries ?? {})
        .filter(([key]) => key.startsWith(RENDERER_STORAGE_DELETION_PREFIX))
        .map(([key, value]) => [
          key.slice(RENDERER_STORAGE_DELETION_PREFIX.length),
          parseRendererStorageIntent(value),
        ]),
    );
    if (Object.keys(importedIntents).length > 0) {
      await withTimeout(
        Promise.resolve(options.commitImportedStorageIntents(importedIntents)),
        options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
      );
    }
    // Preserve recovery-only and partially imported data, while the live legacy origin
    // remains authoritative until the first cutover. Only its current pending journal may
    // override SQLite; journals in the saved export or a prior partial import are historical.
    const current = untrackedCurrent ?? (await readTarget(options));
    await importAndVerify(
      options,
      snapshot,
      {
        ...withoutDeletionJournal(current),
        ...withoutDeletionJournal(snapshot.entries),
        ...liveLegacyEntries,
      },
      false,
    );
    return 'completed';
  } catch (error) {
    // catch-no-log-ok reportFailure logs a sanitized migration failure without exported values.
    reportFailure(error);
    if (state?.hasCompleted && snapshot && state.exportSha256 === snapshot.sha256) {
      try {
        saveState(options, 'needsRepair', snapshot, true);
      } catch (stateError) {
        // catch-no-log-ok reportFailure logs the state-write failure through the sanitizer.
        reportFailure(stateError);
      }
    }
    return 'failed';
  }
}

/** Check the actual main renderer after load; callers reload after repair or fall back on failure. */
export async function checkRendererOriginStorageHealth(
  options: WebStorageOriginMigrationOptions,
  contents: Pick<WebContents, 'executeJavaScript'>,
  allowRepair = true,
): Promise<RendererOriginHealthResult> {
  const env = options.env ?? process.env;
  if (
    normalizeDevServerUrl(options.devServerUrl) ||
    env[ENV_FORCE_FILE_ORIGIN] === '1' ||
    env[ENV_SKIP_ORIGIN_MIGRATION] === '1'
  ) {
    return 'failed';
  }
  let snapshot: StorageExport | undefined;
  let state: MigrationState | undefined;
  try {
    assertStorageResetCompleted(options);
    state = readState(options);
    snapshot = readStorageExport(options);
    if (state?.phase !== 'completed') throw new Error('Renderer origin migration is not completed');
    requireCompletedExport(state, snapshot);
    const current = await withTimeout(
      readStorage(contents),
      options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
    );
    if (storageHealthy(options, snapshot, current)) return 'healthy';
    if (!allowRepair) throw new Error('Renderer origin storage remains unhealthy after repair');
    if (!options.unloadRendererBeforeRepair) {
      throw new Error('Renderer origin repair requires unloading the live renderer');
    }
    await withTimeout(
      options.unloadRendererBeforeRepair(),
      options.timeoutMs ?? MIGRATION_TIMEOUT_MS,
    );
    // Navigation can finish pending writes/Forget actions after the live health snapshot.
    // Re-read only after its application scripts are gone; repair must retain those journals.
    const unloaded = await readTarget(options);
    await repairStorage(options, snapshot, unloaded);
    return 'repaired';
  } catch (error) {
    // catch-no-log-ok reportFailure logs a sanitized migration failure without exported values.
    reportFailure(error);
    if (state?.hasCompleted && snapshot && state.exportSha256 === snapshot.sha256) {
      try {
        saveState(options, 'needsRepair', snapshot, true);
      } catch (stateError) {
        // catch-no-log-ok reportFailure logs the state-write failure through the sanitizer.
        reportFailure(stateError);
      }
    }
    return 'failed';
  }
}
