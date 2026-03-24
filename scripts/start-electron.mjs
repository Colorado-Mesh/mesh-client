#!/usr/bin/env node
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export function resolveLocalElectronBin(platform = process.platform, fileExists = existsSync) {
  const distDir = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  const platformCandidates =
    platform === 'darwin'
      ? [path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')]
      : platform === 'win32'
        ? [path.join(distDir, 'electron.exe')]
        : [path.join(distDir, 'electron')];
  const fallbackCandidates = [
    path.join(distDir, 'electron'),
    path.join(distDir, 'electron.exe'),
    path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const candidates = [...platformCandidates, ...fallbackCandidates];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return platformCandidates[0];
}

export function classifyElectronStartupError(stderrText) {
  const lower = String(stderrText || '').toLowerCase();
  const hasSharedLibraryFailure = lower.includes('error while loading shared libraries');
  const hasMissingFfmpeg = lower.includes('libffmpeg.so');
  const hasCannotOpenSharedObject = lower.includes('cannot open shared object file');
  if (hasSharedLibraryFailure && hasMissingFfmpeg && hasCannotOpenSharedObject) {
    return 'linux-libffmpeg-missing';
  }
  const hasXServerMissing = lower.includes('missing x server or $display');
  const hasOzoneX11Failure = lower.includes('ozone_platform_x11.cc');
  const hasAuraPlatformInitFailure = lower.includes('platform failed to initialize');
  if ((hasXServerMissing || hasOzoneX11Failure) && hasAuraPlatformInitFailure) {
    return 'linux-display-missing';
  }
  return null;
}

export function fedoraLibffmpegRemediation() {
  return [
    '[mesh-client] Detected Linux startup failure: libffmpeg.so could not be loaded.',
    '[mesh-client] Preferred Linux BLE launch for npm start uses ambient capability (setpriv), not file capabilities on Electron.',
    '[mesh-client] This failure can happen on Fedora/glibc after applying setcap directly to Electron.',
    '[mesh-client] Launch with ambient capability:',
    "  sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc 'npm start'",
    '[mesh-client] Remove file capability from the local Electron binary:',
    '  sudo setcap -r ./node_modules/electron/dist/electron',
    '[mesh-client] Keep file capabilities for packaged release binaries only (setcap on extracted executable).',
  ].join('\n');
}

export function linuxDisplayMissingRemediation() {
  return [
    '[mesh-client] Detected Linux startup failure: no active desktop display (X11/Wayland).',
    '[mesh-client] Electron could not initialize a GUI backend (Missing X server or $DISPLAY).',
    '[mesh-client] If you are in SSH or headless mode, launch from a desktop session instead.',
    '[mesh-client] If already in a desktop session, verify display environment variables:',
    '  echo "DISPLAY=$DISPLAY WAYLAND_DISPLAY=$WAYLAND_DISPLAY XDG_SESSION_TYPE=$XDG_SESSION_TYPE"',
    '[mesh-client] If BLE only works via setpriv, preserve display auth when launching:',
    '  sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc "export DISPLAY=$DISPLAY; export XAUTHORITY=$XAUTHORITY; npm start"',
    '[mesh-client] For Wayland sessions, forcing X11 may help:',
    '  ELECTRON_OZONE_PLATFORM_HINT=x11 npm start',
  ].join('\n');
}

export async function runStartElectron(argv = process.argv.slice(2)) {
  const child = spawn(resolveLocalElectronBin(), ['.', ...argv], {
    cwd: projectRoot,
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
  });

  let stderrBuffer = '';
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer += text;
    process.stderr.write(text);
  });

  child.on('error', (err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    const classification = classifyElectronStartupError(stderrBuffer);
    if (classification === 'linux-libffmpeg-missing') {
      process.stderr.write(`\n${fedoraLibffmpegRemediation()}\n`);
    } else if (classification === 'linux-display-missing') {
      process.stderr.write(`\n${linuxDisplayMissingRemediation()}\n`);
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runStartElectron();
}
