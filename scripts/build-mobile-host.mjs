#!/usr/bin/env node
/**
 * Bundle the Electron main process (`src/main/index.ts`) as the mobile host Web Worker.
 *
 * The main-process sources are not modified for mobile. Instead this build:
 * - redirects `electron` and Node built-ins to the mobile shims in `src/mobile/host/shims/`;
 * - swaps desktop-only packages (electron-updater, systeminformation, dbus-next, ws, undici);
 * - forces mqtt.js onto its Node TCP/TLS transports (backed by the native socket shims);
 * - replaces main modules that talk to desktop-only services (`MOBILE_MODULE_OVERRIDES`);
 * - defines `process.env.VITEST` so lazily loaded sibling chunks are bundled inline (the
 *   worker has no `require`).
 *
 * Output: `dist-mobile/host/host-worker.js` + `sqlite3.wasm`.
 * Usage: node scripts/build-mobile-host.mjs [--minify] [--metafile=path] [--outdir=dir]
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const SHIMS = path.join(projectRoot, 'src/mobile/host/shims');

/** Node built-in → shim file (relative to `src/mobile/host/shims/`). */
export const MOBILE_HOST_BUILTIN_SHIMS = {
  electron: 'electron.ts',
  sqlite: 'node/sqlite.ts',
  fs: 'node/fs.ts',
  'fs/promises': 'node/fs-promises.ts',
  os: 'node/os.ts',
  crypto: 'node/crypto.ts',
  net: 'node/net.ts',
  tls: 'node/tls.ts',
  dgram: 'node/dgram.ts',
  dns: 'node/dns.ts',
  'dns/promises': 'node/dns-promises.ts',
  child_process: 'node/child_process.ts',
  http: 'node/http-module.ts',
  https: 'node/https-module.ts',
  zlib: 'node/zlib.ts',
  url: 'node/url.ts',
  module: 'node/module.ts',
  worker_threads: 'node/worker_threads.ts',
  readline: 'node/readline.ts',
  util: 'node/util.ts',
  'util/types': 'node/util-types.ts',
  stream: 'node/stream.ts',
  'stream/promises': 'node/stream-promises.ts',
  'stream/web': 'node/stream-web.ts',
  assert: 'node/assert.ts',
  'assert/strict': 'node/assert.ts',
  querystring: 'node/querystring.ts',
  timers: 'node/timers.ts',
  'timers/promises': 'node/timers.ts',
  perf_hooks: 'node/misc.ts',
  async_hooks: 'node/misc.ts',
  v8: 'node/misc.ts',
  diagnostics_channel: 'node/misc.ts',
  tty: 'node/misc.ts',
  inspector: 'node/misc.ts',
  process: 'node/process-module.ts',
  http2: 'node/empty.ts',
  vm: 'node/empty.ts',
  cluster: 'node/empty.ts',
  constants: 'node/empty.ts',
  console: 'node/empty.ts',
  // Packages
  ws: 'pkg/ws.ts',
  undici: 'pkg/undici.ts',
  'electron-updater': 'pkg/inert-packages.ts',
  systeminformation: 'pkg/inert-packages.ts',
  'dbus-next': 'pkg/dbus-next.ts',
  usocket: 'node/empty.ts',
};

/** Browser packages for the remaining Node built-ins. */
const PACKAGE_BUILTINS = {
  path: 'path-browserify',
  'path/posix': 'path-browserify',
  events: 'events/events.js',
  buffer: 'buffer/index.js',
  string_decoder: 'string_decoder/lib/string_decoder.js',
};

/**
 * Main-process modules replaced on mobile (path relative to `src/main/` → mobile module).
 * Each replacement exports the same API as the desktop module.
 */
export const MOBILE_MODULE_OVERRIDES = {
  'gatt-sidecar-proxy.ts': 'src/mobile/host/overrides/gatt-mobile-proxy.ts',
  'translation/loadTranslationManifest.ts': 'src/mobile/host/overrides/loadTranslationManifest.ts',
  'gps.ts': 'src/mobile/host/overrides/gps.ts',
};

function mobileHostResolvePlugin() {
  return {
    name: 'mobile-host-resolve',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path;
        const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
        if (Object.prototype.hasOwnProperty.call(MOBILE_HOST_BUILTIN_SHIMS, bare)) {
          return { path: path.join(SHIMS, MOBILE_HOST_BUILTIN_SHIMS[bare]) };
        }
        if (Object.prototype.hasOwnProperty.call(PACKAGE_BUILTINS, bare)) {
          return { path: require.resolve(PACKAGE_BUILTINS[bare]) };
        }
        if (bare === 'mqtt') {
          return { path: path.join(projectRoot, 'node_modules/mqtt/build/index.js') };
        }
        // mqtt.js environment probe → Node mode (TCP/TLS transports).
        if (
          /(^|\/)is-browser(\.js)?$/.test(bare) &&
          args.importer.includes(`${path.sep}mqtt${path.sep}`)
        ) {
          return { path: path.join(SHIMS, 'pkg/mqtt-is-browser.ts') };
        }
        if (args.importer.startsWith(path.join(projectRoot, 'src/main')) && bare.startsWith('.')) {
          const resolved = path.resolve(path.dirname(args.importer), bare);
          const rel = path.relative(path.join(projectRoot, 'src/main'), resolved);
          for (const [from, to] of Object.entries(MOBILE_MODULE_OVERRIDES)) {
            if (rel === from.replace(/\.ts$/, '') || rel === from) {
              return { path: path.join(projectRoot, to) };
            }
          }
        }
        return undefined;
      });
    },
  };
}

/**
 * @param {{ minify?: boolean, metafilePath?: string | null, outdir?: string, buildInfoRaw?: string }} [opts]
 */
export async function buildMobileHost(opts = {}) {
  const outdir = path.resolve(projectRoot, opts.outdir ?? 'dist-mobile/host');
  fs.mkdirSync(outdir, { recursive: true });
  const result = await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: { 'host-worker': 'src/mobile/host/worker.ts' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022', 'chrome111', 'safari16'],
    outdir,
    minify: opts.minify === true,
    sourcemap: false,
    metafile: Boolean(opts.metafilePath),
    logLevel: 'warning',
    mainFields: ['browser', 'module', 'main'],
    conditions: ['worker', 'browser', 'import', 'default'],
    define: {
      __MESH_CLIENT_BUILD_INFO__: JSON.stringify(
        opts.buildInfoRaw ?? process.env.MESH_CLIENT_BUILD_INFO ?? '',
      ),
      // Sibling chunks load through static imports when VITEST is set (see src/main/load*.ts).
      'process.env.VITEST': '"1"',
      'process.env.NODE_ENV': '"production"',
      __dirname: '"/app/dist-electron/main"',
      __filename: '"/app/dist-electron/main/index.js"',
      global: 'globalThis',
    },
    plugins: [mobileHostResolvePlugin()],
    // `import.meta.url` stays meaningful in the worker (sqlite-wasm locates its .wasm).
    supported: { 'import-meta': true },
  });
  fs.copyFileSync(
    require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'),
    path.join(outdir, 'sqlite3.wasm'),
  );
  if (opts.metafilePath && result.metafile) {
    fs.writeFileSync(path.resolve(projectRoot, opts.metafilePath), JSON.stringify(result.metafile));
  }
  return result;
}

function parseArgs(argv) {
  const out = { minify: false, metafilePath: null, outdir: undefined };
  for (const a of argv) {
    if (a === '--minify') out.minify = true;
    else if (a.startsWith('--metafile=')) out.metafilePath = a.slice('--metafile='.length);
    else if (a.startsWith('--outdir=')) out.outdir = a.slice('--outdir='.length);
    else throw new Error(`Unknown build-mobile-host argument: ${a}`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  buildMobileHost(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
