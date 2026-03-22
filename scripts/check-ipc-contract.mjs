#!/usr/bin/env node
/**
 * Pre-commit / CI check for IPC contract alignment.
 *
 * Verifies that every channel the preload calls on ipcRenderer has a matching
 * handler registered in the main process, and vice versa. Catches the most
 * common AI regression pattern: renaming a channel in one place but not the other.
 *
 * Channels:
 *   - renderer→main (invoke / send): preload ipcRenderer.invoke/send  ↔  main ipcMain.handle/on
 *   - main→renderer (push events):   main webContents.send  ↔  preload ipcRenderer.on
 *
 * To suppress a known intentional mismatch, add a comment on the same line:
 *   // ipc-contract-ok
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PRELOAD_FILE = path.join(ROOT, 'src', 'preload', 'index.ts');
const MAIN_FILES = [
  path.join(ROOT, 'src', 'main', 'index.ts'),
  path.join(ROOT, 'src', 'main', 'updater.ts'),
];

const SUPPRESS = /\/\/\s*ipc-contract-ok\b/;

// ─── Extraction helpers ────────────────────────────────────────────────────────

/**
 * Extract channel name strings from lines matching a given IPC pattern.
 * Looks for: pattern('channel-name')  or  pattern("channel-name")
 */
function extractChannels(source, ipcPattern) {
  const channels = new Set();
  const re = new RegExp(String.raw`\b${ipcPattern}\s*\(\s*['"]([^'"]+)['"]`, 'g');

  for (const match of source.matchAll(re)) {
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const lineEnd = source.indexOf('\n', match.index);
    const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (!SUPPRESS.test(line)) {
      channels.add(match[1]);
    }
  }
  return channels;
}

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`check-ipc-contract: file not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const preloadSrc = readSource(PRELOAD_FILE);
  const mainSrc = MAIN_FILES.map(readSource).join('\n');

  // Renderer → Main (renderer invokes, main must handle)
  const rendererInvokes = extractChannels(preloadSrc, 'ipcRenderer\\.invoke');
  const rendererSends = extractChannels(preloadSrc, 'ipcRenderer\\.send');
  const mainHandles = extractChannels(mainSrc, 'ipcMain\\.handle');
  const mainOns = extractChannels(mainSrc, 'ipcMain\\.on');

  // Main → Renderer (main pushes events, preload must listen)
  const mainPushes = extractChannels(mainSrc, 'webContents\\.send');
  const rendererListens = extractChannels(preloadSrc, 'ipcRenderer\\.on');

  const errors = [];
  const warnings = [];

  // Every channel the preload invokes must be handled in main
  for (const ch of rendererInvokes) {
    if (!mainHandles.has(ch)) {
      errors.push(`  Preload invokes '${ch}' but no ipcMain.handle found in main`);
    }
  }

  // Every channel the preload sends must be handled via ipcMain.on in main
  for (const ch of rendererSends) {
    if (!mainOns.has(ch)) {
      errors.push(`  Preload sends '${ch}' but no ipcMain.on found in main`);
    }
  }

  // Every channel main pushes to renderer must be listened on in preload
  for (const ch of mainPushes) {
    if (!rendererListens.has(ch)) {
      warnings.push(`  Main pushes '${ch}' but no ipcRenderer.on found in preload`);
    }
  }

  // Every ipcMain.handle that isn't called from preload is a dead handler (warning only)
  for (const ch of mainHandles) {
    if (!rendererInvokes.has(ch)) {
      warnings.push(`  Main handles '${ch}' but preload never invokes it (dead handler)`);
    }
  }

  if (warnings.length > 0) {
    console.warn('check-ipc-contract: warnings (not blocking commit):\n');
    for (const w of warnings) console.warn(w);
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('check-ipc-contract: IPC contract violations (fix before committing):\n');
    for (const e of errors) console.error(e);
    console.error(
      '\nEach channel invoked/sent from the preload must have a matching handler in main.',
    );
    console.error(
      'To suppress a known false positive, add // ipc-contract-ok on the same line.',
    );
    process.exit(1);
  }

  process.exit(0);
}

main();
