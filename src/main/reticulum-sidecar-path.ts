import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { sanitizeLogMessage } from './log-service';

export function sidecarBinaryName(): string {
  return process.platform === 'win32' ? 'mesh-client-reticulum.exe' : 'mesh-client-reticulum';
}

/** Locate `reticulum-sidecar/Cargo.toml` from dev / packaged search roots. */
export function findReticulumSidecarProjectDir(extraRoots: string[] = []): string | null {
  const searchRoots = new Set<string>(extraRoots);
  try {
    searchRoots.add(app.getAppPath());
  } catch {
    // catch-no-log-ok app path unavailable in unit tests without electron ready
  }
  searchRoots.add(process.cwd());
  searchRoots.add(path.resolve(__dirname, '../..'));
  searchRoots.add(path.resolve(__dirname, '../../..'));

  for (const root of searchRoots) {
    const projectDir = path.join(root, 'reticulum-sidecar');
    if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) {
      return projectDir;
    }
  }
  return null;
}

export function resolveSidecarBinaryPath(extraRoots: string[] = []): string {
  const name = sidecarBinaryName();

  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'reticulum-sidecar', name);
    if (fs.existsSync(bundled)) return bundled;
  }

  const projectDir = findReticulumSidecarProjectDir(extraRoots);
  if (projectDir) {
    for (const profile of ['debug', 'release'] as const) {
      const candidate = path.join(projectDir, 'target', profile, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(projectDir, 'target', 'debug', name);
  }

  return path.join(app.getAppPath(), 'reticulum-sidecar', 'target', 'debug', name);
}

let devBuildInFlight: Promise<void> | null = null;

function runCargoBuild(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cargo', ['build'], {
      cwd: projectDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      console.debug('[ReticulumSidecar] cargo:', sanitizeLogMessage(chunk.toString('utf8').trim()));
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8');
      stderr += line;
      console.debug('[ReticulumSidecar] cargo:', sanitizeLogMessage(line.trim()));
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'RETICULUM_CARGO_MISSING: Rust toolchain (cargo) not found. Install from https://rustup.rs then run `pnpm run reticulum:sidecar:build`.',
          ),
        );
        return;
      }
      reject(err);
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `RETICULUM_CARGO_BUILD_FAILED: cargo build exited ${code ?? 'null'}: ${stderr.trim().slice(-400)}`,
        ),
      );
    });
  });
}

/** Dev-only: compile the sidecar when the debug binary is missing. */
export async function ensureDevSidecarBinary(binaryPath: string): Promise<void> {
  if (fs.existsSync(binaryPath)) return;
  if (app.isPackaged) return;

  const projectDir = findReticulumSidecarProjectDir();
  if (!projectDir) {
    throw new Error(
      'RETICULUM_SIDECAR_PROJECT_MISSING: reticulum-sidecar/ not found. Run `pnpm run reticulum:sidecar:build` from the mesh-client repo root.',
    );
  }

  if (!devBuildInFlight) {
    console.debug('[ReticulumSidecar] debug binary missing; running cargo build…');
    devBuildInFlight = runCargoBuild(projectDir).finally(() => {
      devBuildInFlight = null;
    });
  }
  await devBuildInFlight;

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `RETICULUM_SIDECAR_BINARY_MISSING: expected ${binaryPath} after cargo build. Run \`pnpm run reticulum:sidecar:build\` manually.`,
    );
  }
}
