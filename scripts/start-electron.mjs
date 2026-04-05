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
    '[mesh-client] This can happen when required runtime libraries are unavailable.',
    '[mesh-client] Verify your system has the Electron runtime dependencies installed.',
    '[mesh-client] On Fedora/RHEL-based systems, ensure ffmpeg runtime libs are present.',
  ].join('\n');
}

export function linuxDisplayMissingRemediation() {
  return [
    '[mesh-client] Detected Linux startup failure: no active desktop display (X11/Wayland).',
    '[mesh-client] Electron could not initialize a GUI backend (Missing X server or $DISPLAY).',
    '[mesh-client] If you are in SSH or headless mode, launch from a desktop session instead.',
    '[mesh-client] If already in a desktop session, verify display environment variables:',
    '  echo "DISPLAY=$DISPLAY WAYLAND_DISPLAY=$WAYLAND_DISPLAY XDG_SESSION_TYPE=$XDG_SESSION_TYPE"',
    '[mesh-client] For Wayland sessions, forcing X11 may help:',
    '  ELECTRON_OZONE_PLATFORM_HINT=x11 pnpm start',
  ].join('\n');
}

export async function runStartElectron(argv = process.argv.slice(2)) {
  // Prefer Chromium's namespace sandbox on Linux and skip only the SUID helper path.
  // This avoids requiring root-owned chrome-sandbox setup in local/dev environments.
  const linuxArgs =
    process.platform === 'linux' && !argv.includes('--disable-setuid-sandbox')
      ? ['--disable-setuid-sandbox']
      : [];
  const launch = (extraArgs = [], runId = 'pre-fix') => {
    const spawnArgs = ['.', ...linuxArgs, ...extraArgs, ...argv];
    const child = spawn(resolveLocalElectronBin(), spawnArgs, {
      cwd: projectRoot,
      stdio: ['inherit', 'inherit', 'pipe'],
      env: process.env,
    });

    let stderrBuffer = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      if (runId === 'post-fix') {
        process.stderr.write(text);
      }
    });

    child.on('error', (err) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    });

    child.on('close', (code, signal) => {
      const noUsableSandbox = /No usable sandbox!/i.test(stderrBuffer);
      if (
        process.platform === 'linux' &&
        noUsableSandbox &&
        !spawnArgs.includes('--no-sandbox') &&
        !argv.includes('--no-sandbox')
      ) {
        launch(['--no-sandbox'], 'post-fix');
        return;
      }

      // Initial Linux attempt buffers stderr so expected sandbox-fallback noise
      // is not shown when retry succeeds. If no fallback path is taken, flush now.
      if (runId === 'pre-fix' && stderrBuffer.length > 0) {
        process.stderr.write(stderrBuffer);
      }
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
  };

  launch();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void runStartElectron();
}
