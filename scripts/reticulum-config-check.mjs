#!/usr/bin/env node
/**
 * Dev convenience: run packaged/local sidecar validate-config against userData.
 * Product path is in-app Network → Check config (IPC). This script is for maintainers.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function userDataConfigDir() {
  const override = process.env.MESH_CLIENT_RETICULUM_CONFIG_DIR;
  if (override) return override;
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'mesh-client',
      'reticulum',
      'config',
    );
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'mesh-client', 'reticulum', 'config');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'mesh-client', 'reticulum', 'config');
}

function findBinary() {
  const name = process.platform === 'win32' ? 'mesh-client-reticulum.exe' : 'mesh-client-reticulum';
  for (const profile of ['debug', 'release']) {
    const candidate = path.join(ROOT, 'reticulum-sidecar', 'target', profile, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const configDir = userDataConfigDir();
const binary = findBinary();
if (!binary) {
  console.error(
    'reticulum:config:check: sidecar binary not found. Run `pnpm run reticulum:sidecar:build`.',
  );
  process.exit(1);
}

console.log(`reticulum:config:check: ${binary}`);
console.log(`config dir: ${configDir}`);

const result = spawnSync(
  binary,
  ['validate-config', '--reticulum-config-dir', configDir, '--json'],
  { encoding: 'utf8' },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
