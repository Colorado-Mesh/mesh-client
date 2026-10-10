import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { MS_PER_MINUTE } from '../shared/timeConstants';
import { sanitizeLogMessage } from './log-service';

/** Cap hung `cargo build` so unpackaged connect cannot stall forever. */
export const BLE_SIDECAR_CARGO_BUILD_TIMEOUT_MS = 15 * MS_PER_MINUTE;

export function sidecarBinaryName(): string {
  return process.platform === 'win32' ? 'mesh-hub-ble.exe' : 'mesh-hub-ble';
}

/** Locate `ble-sidecar/Cargo.toml` from dev / packaged search roots. */
export function findBleSidecarProjectDir(extraRoots: string[] = []): string | null {
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
    const projectDir = path.join(root, 'ble-sidecar');
    if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) {
      return projectDir;
    }
  }
  return null;
}

export function resolveSidecarBinaryPath(extraRoots: string[] = []): string {
  const name = sidecarBinaryName();

  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'ble-sidecar', name);
    if (fs.existsSync(bundled)) return bundled;
  }

  try {
    const appBundled = path.join(app.getAppPath(), 'resources', 'ble-sidecar', name);
    if (fs.existsSync(appBundled)) return appBundled;
  } catch {
    // catch-no-log-ok app path unavailable in unit tests without electron ready
  }

  const projectDir = findBleSidecarProjectDir(extraRoots);
  if (projectDir) {
    for (const profile of ['debug', 'release'] as const) {
      const candidate = path.join(projectDir, 'target', profile, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(projectDir, 'target', 'debug', name);
  }

  return path.join(app.getAppPath(), 'ble-sidecar', 'target', 'debug', name);
}

let devBuildInFlight: Promise<void> | null = null;

/** Cargo build args for the Bluetooth (GATT) helper. */
export function sidecarCargoBuildArgs(): string[] {
  return ['build', '--features', 'gatt-ble'];
}

export function formatCargoBuildError(code: number | null, stderr: string): string {
  const tail = stderr.trim().split(/\r?\n/).slice(-8).join('\n');
  return `BLE_SIDECAR_CARGO_BUILD_FAILED: cargo build exited ${code ?? 'null'}${tail ? `\n${tail}` : ''}`;
}

function runCargoBuild(projectDir: string): Promise<void> {
  const cargoArgs = sidecarCargoBuildArgs();
  return new Promise((resolve, reject) => {
    const proc = spawn('cargo', cargoArgs, {
      cwd: projectDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stderr = '';
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      finish();
    };
    const timeout = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          proc.kill();
        } else {
          proc.kill('SIGTERM');
        }
      } catch {
        // catch-no-log-ok best-effort kill after cargo timeout
      }
      settle(() => {
        reject(
          new Error(
            `BLE_SIDECAR_CARGO_BUILD_TIMEOUT: cargo build exceeded ${BLE_SIDECAR_CARGO_BUILD_TIMEOUT_MS}ms`,
          ),
        );
      });
    }, BLE_SIDECAR_CARGO_BUILD_TIMEOUT_MS);
    proc.stdout?.on('data', (chunk: Buffer) => {
      console.debug('[BleSidecar] cargo:', sanitizeLogMessage(chunk.toString('utf8').trim()));
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8');
      stderr += line;
      console.debug('[BleSidecar] cargo:', sanitizeLogMessage(line.trim()));
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              'BLE_SIDECAR_CARGO_MISSING: Rust toolchain (cargo) not found. Install from https://rustup.rs then run `pnpm run ble:sidecar:build`.',
            ),
          );
          return;
        }
        reject(err);
      });
    });
    proc.on('exit', (code) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(formatCargoBuildError(code, stderr)));
      });
    });
  });
}

/** @internal Exported for unit tests (timeout / hang termination). */
export const runCargoBuildForTests = runCargoBuild;

/** Newest mtime among Cargo.toml and ble-sidecar/src Rust sources. */
export function newestBleSidecarSourceMtimeMs(projectDir: string): number {
  let newest = 0;
  const cargoToml = path.join(projectDir, 'Cargo.toml');
  if (fs.existsSync(cargoToml)) {
    newest = Math.max(newest, fs.statSync(cargoToml).mtimeMs);
  }
  const srcDir = path.join(projectDir, 'src');
  if (!fs.existsSync(srcDir)) return newest;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.rs')) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  };
  walk(srcDir);
  return newest;
}

/** True when Rust sources are newer than the built sidecar binary. */
export function sidecarBinaryIsStale(binaryPath: string, projectDir: string): boolean {
  if (!fs.existsSync(binaryPath)) return true;
  const binaryMtime = fs.statSync(binaryPath).mtimeMs;
  return newestBleSidecarSourceMtimeMs(projectDir) > binaryMtime;
}

export type DevSidecarEnsureAction = 'await-build' | 'noop';

/**
 * Decide whether connect must wait on cargo or can skip.
 * Dev connect always runs the current tree: missing, featureless, or mtime-stale
 * binaries block until `cargo build` finishes (no stale-binary background start).
 */
export function resolveDevSidecarEnsureAction(opts: {
  missing: boolean;
  stale: boolean;
}): DevSidecarEnsureAction {
  if (opts.missing || opts.stale) return 'await-build';
  return 'noop';
}

async function runDevSidecarCargoBuild(projectDir: string, reason: string): Promise<void> {
  if (!devBuildInFlight) {
    console.debug(`[BleSidecar] ${reason}; running cargo build…`);
    devBuildInFlight = runCargoBuild(projectDir).finally(() => {
      devBuildInFlight = null;
    });
  }
  await devBuildInFlight;
}

export interface EnsureDevSidecarBinaryOpts {
  /**
   * Override project discovery (tests).
   * Pass `null` to skip discovery (Flatpak / no Rust tree).
   * Omit or pass `undefined` to run `findBleSidecarProjectDir()`.
   */
  projectDir?: string | null;
  /** Replace cargo build runner (tests). */
  runBuild?: (projectDir: string, reason: string) => Promise<void>;
}

function fsErrnoCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * No Rust tree: use a bundled binary if it is a regular executable file.
 * Missing path → PROJECT_MISSING; present but not executable → NOT_EXECUTABLE;
 * other filesystem errors propagate.
 */
function assertBundledSidecarBinary(binaryPath: string): void {
  let st: fs.Stats;
  try {
    st = fs.statSync(binaryPath);
  } catch (err) {
    if (fsErrnoCode(err) === 'ENOENT') {
      throw new Error(
        'BLE_SIDECAR_PROJECT_MISSING: ble-sidecar/ not found. Run `pnpm run ble:sidecar:build` from the repo root.',
      );
    }
    throw err;
  }
  if (!st.isFile()) {
    throw new Error(`BLE_SIDECAR_BINARY_NOT_EXECUTABLE: expected a regular file at ${binaryPath}`);
  }
  // OS-specific: Windows does not use Unix execute bits the same way.
  if (process.platform === 'win32') return;
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch (err) {
    if (fsErrnoCode(err) === 'EACCES') {
      throw new Error(
        `BLE_SIDECAR_BINARY_NOT_EXECUTABLE: ${binaryPath} exists but is not executable (fix packaging permissions or chmod 755)`,
      );
    }
    throw err;
  }
}

/** Dev-only: compile the sidecar when the debug binary is missing or unusable. */
export async function ensureDevSidecarBinary(
  binaryPath: string,
  opts?: EnsureDevSidecarBinaryOpts,
): Promise<void> {
  if (app.isPackaged) return;

  // Only explicit null skips discovery; undefined / omitted still discover.
  const projectDir =
    opts?.projectDir === null ? null : (opts?.projectDir ?? findBleSidecarProjectDir());
  if (!projectDir) {
    assertBundledSidecarBinary(binaryPath);
    return;
  }

  const missing = !fs.existsSync(binaryPath);
  const stale = !missing && sidecarBinaryIsStale(binaryPath, projectDir);
  const action = resolveDevSidecarEnsureAction({ missing, stale });

  if (action === 'noop') {
    return;
  }

  const reason = missing ? 'debug binary missing' : 'sidecar sources newer than binary';
  const runBuild = opts?.runBuild ?? runDevSidecarCargoBuild;
  await runBuild(projectDir, reason);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `BLE_SIDECAR_BINARY_MISSING: expected ${binaryPath} after cargo build. Run \`pnpm run ble:sidecar:build\` manually.`,
    );
  }
}
