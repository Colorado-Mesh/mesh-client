// Poll until Vite and Electron bundles (main + preload) are ready before launching Electron.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const HOST = 'localhost';
const PORT = 5173;
const INTERVAL_MS = 300;

export const DEV_ELECTRON_BUNDLE_PATHS = {
  main: path.join(projectRoot, 'dist-electron/main/index.js'),
  preload: path.join(projectRoot, 'dist-electron/preload/index.js'),
};

/** @param {Record<'main' | 'preload', string>} paths @param {typeof fs.statSync} [statSync] */
export function areElectronBundlesReady(paths = DEV_ELECTRON_BUNDLE_PATHS, statSync = fs.statSync) {
  for (const filePath of Object.values(paths)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** @param {string} host @param {number} port */
export function isVitePortOpen(host = HOST, port = PORT) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * @param {{
 *   host?: string;
 *   port?: number;
 *   intervalMs?: number;
 *   paths?: Record<'main' | 'preload', string>;
 *   isPortOpen?: (host: string, port: number) => Promise<boolean>;
 *   statSync?: typeof fs.statSync;
 *   sleep?: (ms: number) => Promise<void>;
 * }} [options]
 */
export async function waitForDevReady(options = {}) {
  const {
    host = HOST,
    port = PORT,
    intervalMs = INTERVAL_MS,
    paths = DEV_ELECTRON_BUNDLE_PATHS,
    isPortOpen = isVitePortOpen,
    statSync = fs.statSync,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  for (;;) {
    const viteUp = await isPortOpen(host, port);
    const bundlesReady = areElectronBundlesReady(paths, statSync);
    if (viteUp && bundlesReady) return;
    await sleep(intervalMs);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void waitForDevReady().then(() => process.exit(0));
}
