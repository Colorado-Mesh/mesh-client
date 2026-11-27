/**
 * Mobile host worker entry: boots Node/Electron shims, mounts durable storage, then runs the
 * unmodified Electron main process (`src/main/index.ts`).
 *
 * Boot order (failure at any step posts `bootFailed` and the UI shows the error screen):
 * 1. Receive `boot` config from the UI thread (platform, version, safeStorage key).
 * 2. Load SQLite (OPFS SyncAccessHandle pool; in-memory + snapshots when OPFS is unavailable).
 * 3. Mount the `fs` persistence backend and restore `/data`.
 * 4. Import main; it registers IPC handlers and runs `app.whenReady()` (DB init, window).
 * 5. When main loads its window, post `ready` so the UI starts the renderer.
 */
import './globals';

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

import { NativePersistBackend, OpfsPersistBackend } from './fsPersistence';
import {
  bindPort,
  getBootConfig,
  handleUiMessage,
  onLifecycle,
  postToUi,
  registerInvokeHandler,
  requestUi,
  setBootConfig,
  setIpcEventFactory,
} from './hostChannel';
import { enableOpfsDirect } from './opfsDirect';
import { type HostBootConfig, serializeError, type UiToHostMessage } from './protocol';
import { initSharedDir, isMirroredPath, queueSharedPush } from './sharedDir';
import {
  createIpcEvent,
  handleProtocolRequest,
  markAppReady,
  onPrimaryWindowLoaded,
} from './shims/electron';
import { mobileFetch } from './shims/nativeFetch';
import {
  ensureBaseDirectories,
  flushFs,
  mountPersistence,
  type PersistBackend,
  setExportSink,
  setMirrorHook,
  writeImportedFile,
} from './shims/node/fs';
import {
  flushMemoryDatabases,
  seedMemorySnapshot,
  setMemorySnapshotWriter,
  setSqliteRuntime,
} from './shims/node/sqlite';
import { MOBILE_PATHS } from './shims/paths';

/** Persist path prefix for in-memory SQLite snapshots (memory backend only). */
const SQLITE_SNAPSHOT_DIR = '/data/.sqlite-snapshots';
const SAH_POOL_NAME = 'mesh-sahpool';
const SAH_POOL_DIR = '/mesh-sqlite';
const SAH_POOL_CAPACITY = 16;

const g = globalThis as unknown as Record<string, unknown>;

function forwardConsole(): void {
  const orig = { warn: console.warn.bind(console), error: console.error.bind(console) };
  const fmt = (args: unknown[]) =>
    args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
      .join(' ');
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    postToUi({ t: 'log', level: 'warn', text: `[host] ${fmt(args)}` });
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    postToUi({ t: 'log', level: 'error', text: `[host] ${fmt(args)}` });
  };
}

async function initSqlite(wasmUrl: string): Promise<'opfs-sahpool' | 'memory'> {
  const sqlite3 = await (sqlite3InitModule as unknown as (o: unknown) => Promise<unknown>)({
    locateFile: () => wasmUrl,
    print: (s: string) => {
      console.debug(`[sqlite] ${s}`);
    },
    printErr: (s: string) => {
      console.debug(`[sqlite] ${s}`);
    },
  });
  try {
    const pool = await (
      sqlite3 as {
        installOpfsSAHPoolVfs(
          o: unknown,
        ): Promise<{ reserveMinimumCapacity(n: number): Promise<number> }>;
      }
    ).installOpfsSAHPoolVfs({
      name: SAH_POOL_NAME,
      directory: SAH_POOL_DIR,
      initialCapacity: SAH_POOL_CAPACITY,
    });
    await pool.reserveMinimumCapacity(SAH_POOL_CAPACITY);
    setSqliteRuntime({ sqlite3, pool });
    return 'opfs-sahpool';
  } catch (e) {
    console.warn(
      `mcL1520 [mobile/host] OPFS SQLite pool unavailable, using in-memory databases with snapshots: ${e instanceof Error ? e.message : String(e)}`,
    );
    setSqliteRuntime({ sqlite3, pool: null });
    return 'memory';
  }
}

async function choosePersistence(config: HostBootConfig): Promise<PersistBackend | null> {
  if (await OpfsPersistBackend.isAvailable()) return new OpfsPersistBackend();
  if (config.mobilePlatform !== 'web') return new NativePersistBackend();
  return null;
}

function snapshotPathFor(dbPath: string): string {
  return `${SQLITE_SNAPSHOT_DIR}/${encodeURIComponent(dbPath)}`;
}

async function boot(
  config: HostBootConfig & { wasmUrl: string; sidecarAvailable: boolean },
): Promise<void> {
  setBootConfig(config);
  const proc = g.process as Record<string, unknown> & { env: Record<string, string> };
  proc.platform = config.nodePlatform;
  // Mobile installs are single-version: accept forward schema upgrades without a blocking prompt.
  proc.env.MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE = '1';
  // No legacy file:// renderer origin exists on mobile; skip the desktop origin migration.
  proc.env.MESH_CLIENT_SKIP_ORIGIN_MIGRATION = '1';
  g.__meshSidecarAvailable = config.sidecarAvailable;
  g.__meshHostExit = () => void requestUi('quit').catch(() => {});

  // Main fetches arbitrary origins; route them through the native HTTP stack.
  g.__meshWebFetch = globalThis.fetch.bind(globalThis);
  g.fetch = mobileFetch;

  const sqliteMode = await initSqlite(config.wasmUrl);
  const backend = await choosePersistence(config);
  if (backend) await mountPersistence(backend);
  // Large tile caches bypass the in-memory volume when OPFS is available.
  if (backend?.name === 'opfs') enableOpfsDirect();
  ensureBaseDirectories();

  if (sqliteMode === 'memory') {
    const fs = (await import('./shims/node/fs')).default as {
      existsSync(p: string): boolean;
      readdirSync(p: string): string[];
      readFileSync(p: string): Uint8Array;
      mkdirSync(p: string, o: unknown): void;
      writeFileSync(p: string, b: Uint8Array): void;
      rmSync(p: string, o: unknown): void;
    };
    fs.mkdirSync(SQLITE_SNAPSHOT_DIR, { recursive: true });
    for (const name of fs.readdirSync(SQLITE_SNAPSHOT_DIR)) {
      seedMemorySnapshot(
        decodeURIComponent(name),
        new Uint8Array(fs.readFileSync(`${SQLITE_SNAPSHOT_DIR}/${name}`)),
      );
    }
    setMemorySnapshotWriter((dbPath, bytes) => {
      const p = snapshotPathFor(dbPath);
      if (bytes.byteLength === 0) fs.rmSync(p, { force: true });
      else fs.writeFileSync(p, bytes);
      return flushFs();
    });
  }

  if (config.sidecarAvailable) {
    setMirrorHook({ isMirrored: isMirroredPath, push: queueSharedPush });
    await initSharedDir().catch((e: unknown) => {
      console.error(
        `mcL1525 [mobile/host] Reticulum shared directory unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
    // `resolveSidecarBinaryPath()` checks the bundled resources path; the native plugin runs it.
    writeImportedFile(
      `${MOBILE_PATHS.app}/resources/reticulum-sidecar/mesh-client-reticulum`,
      new Uint8Array(0),
    );
  }

  setExportSink(async (path, bytes) => {
    await requestUi('exportFile', { name: path.slice(path.lastIndexOf('/') + 1), bytes });
  });

  onLifecycle((state) => {
    if (state === 'pause' || state === 'beforeQuit') {
      void flushMemoryDatabases().then(() => flushFs());
    }
  });

  // UI file pickers copy picked bytes into the host filesystem (dialog.showOpenDialog contract).
  registerInvokeHandler('__mobile:importFile', (_event, name, bytes) => {
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_') || 'file';
    const path = `/imports/${crypto.randomUUID()}/${safe}`;
    writeImportedFile(path, bytes as Uint8Array);
    return path;
  });

  // Custom schemes main serves (`mesh-tiles:`, `mesh-weather:`): the WebView cannot load them,
  // so the UI resolves image URLs through this handler (see bridge/customSchemes.ts).
  registerInvokeHandler('__mobile:protocolFetch', async (_event, url) => {
    if (typeof url !== 'string' || !/^mesh-(tiles|weather):\/\//.test(url)) {
      throw new Error('unsupported scheme');
    }
    const res = await handleProtocolRequest(url);
    if (!res) return { status: 404, contentType: '', bytes: new Uint8Array(0) };
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  });

  setIpcEventFactory(createIpcEvent);
  onPrimaryWindowLoaded(() => {
    postToUi({ t: 'ready' });
  });

  await import('../../main/index');
  markAppReady();
  console.debug(
    `[mobile/host] main loaded (sqlite=${sqliteMode}, fs=${backend?.name ?? 'memory'})`,
  );
  void getBootConfig();
}

self.onmessage = (ev: MessageEvent<UiToHostMessage>) => {
  const msg = ev.data;
  if (msg.t === 'boot') {
    boot(msg.config as HostBootConfig & { wasmUrl: string; sidecarAvailable: boolean }).catch(
      (err: unknown) => {
        console.error(
          `mcL1521 [mobile/host] boot failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        postToUi({ t: 'bootFailed', error: serializeError(err) });
      },
    );
    return;
  }
  handleUiMessage(msg);
};

bindPort((msg, transfer) => {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
});
forwardConsole();
