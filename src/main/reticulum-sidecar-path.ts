import { spawn, spawnSync } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { assertPathInsideRoot, joinUnderRoot } from '../shared/pathUnderRoot';
import { MS_PER_MINUTE } from '../shared/timeConstants';
import { sanitizeLogMessage } from './log-service';

/** Cap hung `cargo build` so unpackaged connect cannot stall forever. */
export const RETICULUM_SIDECAR_CARGO_BUILD_TIMEOUT_MS = 15 * MS_PER_MINUTE;

export function sidecarBinaryName(): string {
  return process.platform === 'win32' ? 'mesh-client-reticulum.exe' : 'mesh-client-reticulum';
}

/** Locate `reticulum-sidecar/Cargo.toml` from dev / packaged search roots. */
export function findReticulumSidecarProjectDir(extraRoots: string[] = []): string | null {
  const searchRoots = new Set<string>(extraRoots);
  try {
    searchRoots.add(app.getAppPath());
  } catch (e: unknown) {
    console.debug(
      '[main/reticulum-sidecar-path] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
  searchRoots.add(process.cwd());
  searchRoots.add(path.resolve(__dirname, '../..'));
  searchRoots.add(path.resolve(__dirname, '../../..'));

  for (const root of searchRoots) {
    const projectDir = joinUnderRoot(root, 'reticulum-sidecar');
    if (fs.existsSync(joinUnderRoot(projectDir, 'Cargo.toml'))) {
      return projectDir;
    }
  }
  return null;
}

export function resolveSidecarBinaryPath(extraRoots: string[] = []): string {
  const name = sidecarBinaryName();

  if (process.resourcesPath) {
    const bundled = joinUnderRoot(process.resourcesPath, 'reticulum-sidecar', name);
    if (fs.existsSync(bundled)) return bundled;
  }

  try {
    const appBundled = joinUnderRoot(app.getAppPath(), 'resources', 'reticulum-sidecar', name);
    if (fs.existsSync(appBundled)) return appBundled;
  } catch (e: unknown) {
    console.debug(
      '[main/reticulum-sidecar-path] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }

  const projectDir = findReticulumSidecarProjectDir(extraRoots);
  if (projectDir) {
    for (const profile of ['debug', 'release'] as const) {
      const candidate = joinUnderRoot(projectDir, 'target', profile, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    return joinUnderRoot(projectDir, 'target', 'debug', name);
  }

  return joinUnderRoot(app.getAppPath(), 'reticulum-sidecar', 'target', 'debug', name);
}

/** True when repo-local `.rsstack` has the minimal rns-stack path deps (rsReticulum + rsLXMF). */
export function hasRsstackWorkspace(projectDir: string): boolean {
  const repoRoot = reticulumSidecarRepoRoot(projectDir);
  const rnsRuntime = joinUnderRoot(
    repoRoot,
    '.rsstack',
    'rsReticulum',
    'crates',
    'rns-runtime',
    'Cargo.toml',
  );
  const lxmfCore = joinUnderRoot(
    repoRoot,
    '.rsstack',
    'rsLXMF',
    'crates',
    'lxmf-core',
    'Cargo.toml',
  );
  return fs.existsSync(rnsRuntime) && fs.existsSync(lxmfCore);
}

/** Cargo build args: full RNS stack (+ BLE) when the repo-local .rsstack is present. */
export function sidecarCargoBuildArgs(projectDir: string): string[] {
  if (hasRsstackWorkspace(projectDir)) {
    return ['build', '--features', 'rns-stack,rns-ble,rns-rnode-tcp'];
  }
  return ['build'];
}

/** Stub sidecar builds omit rsReticulum symbols needed for live path-table peers. */
export function sidecarBinaryLacksRnsStack(binaryPath: string): boolean {
  try {
    const bytes = fs.readFileSync(binaryPath);
    return !bytes.includes(Buffer.from('rns_runtime'));
  } catch (e: unknown) {
    console.debug(
      '[main/reticulum-sidecar-path] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );

    return true;
  }
}

/** Sidecars built without `rns-ble` embed this availability stub string. */
export function sidecarBinaryLacksRnsBle(binaryPath: string): boolean {
  try {
    const bytes = fs.readFileSync(binaryPath);
    return bytes.includes(Buffer.from('rns-ble feature not enabled in this build'));
  } catch (e: unknown) {
    console.debug(
      '[main/reticulum-sidecar-path] catch:',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );

    return true;
  }
}

let devBuildInFlight: Promise<void> | null = null;

/** Repo root containing `reticulum-sidecar/` (parent of project dir). */
export function reticulumSidecarRepoRoot(projectDir: string): string {
  return path.dirname(projectDir);
}

/** True when cargo stderr indicates the rsReticulum packet-tap overlay is missing. */
export function reticulumCargoStderrMissingPacketTap(stderr: string): boolean {
  return (
    stderr.includes('register_packet_tap') ||
    stderr.includes('PacketTapEvent') ||
    stderr.includes('method not found in `ReticulumHandle`')
  );
}

/** Format a failed sidecar cargo build into a user-actionable error message. */
export function formatReticulumCargoBuildError(code: number | null, stderr: string): string {
  if (reticulumCargoStderrMissingPacketTap(stderr)) {
    return (
      'RETICULUM_RNS_PATCH_MISSING: rsReticulum packet-tap overlay not applied. ' +
      'From the mesh-client repo root run `pnpm run reticulum:sidecar:build` ' +
      '(applies patches automatically) or `./scripts/ensure-rsReticulum-patches.sh`.'
    );
  }
  return `RETICULUM_CARGO_BUILD_FAILED: cargo build exited ${code ?? 'null'}: ${stderr.trim().slice(-400)}`;
}

export function ensureRsReticulumPatchesScriptPath(projectDir: string): string {
  return joinUnderRoot(
    reticulumSidecarRepoRoot(projectDir),
    'scripts',
    'ensure-rsReticulum-patches.sh',
  );
}

/** Apply rsReticulum overlays when the repo-local .rsstack workspace exists (no-op for stub builds). */
export function ensureRsReticulumPatches(projectDir: string): void {
  if (!hasRsstackWorkspace(projectDir)) return;

  const repoRoot = reticulumSidecarRepoRoot(projectDir);
  const scriptPath = assertPathInsideRoot(repoRoot, ensureRsReticulumPatchesScriptPath(projectDir));
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `RETICULUM_RNS_PATCH_SCRIPT_MISSING: expected ${scriptPath}. Run \`pnpm run reticulum:sidecar:build\` from the mesh-client repo root.`,
    );
  }

  // Argv-only spawn of a fixed interpreter with the validated script path as its one
  // argument (no shell string, no `shell: true`). Going through `bash` keeps this working on
  // Windows (Git Bash) and in checkouts where the script lost its executable bit.
  // scriptPath is assertPathInsideRoot(repoRoot, ...) above. dangerous-spawn-shell flags any
  // non-literal argument to a shell; here the argument is a file bash runs, never `-c` code.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process, javascript.lang.security.audit.dangerous-spawn-shell.dangerous-spawn-shell
  const result = spawnSync('bash', [scriptPath], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) {
    console.debug('[ReticulumSidecar] patches:', sanitizeLogMessage(output));
  }
  if (result.status !== 0) {
    throw new Error(
      `RETICULUM_RNS_PATCH_APPLY_FAILED: ${output || `ensure-rsReticulum-patches.sh exited ${result.status ?? 'null'}`}`,
    );
  }
}

function runCargoBuild(projectDir: string): Promise<void> {
  const cargoArgs = sidecarCargoBuildArgs(projectDir);
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
      } catch (e: unknown) {
        console.debug(
          '[main/reticulum-sidecar-path] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
      settle(() => {
        reject(
          new Error(
            `RETICULUM_CARGO_BUILD_TIMEOUT: cargo build exceeded ${RETICULUM_SIDECAR_CARGO_BUILD_TIMEOUT_MS}ms`,
          ),
        );
      });
    }, RETICULUM_SIDECAR_CARGO_BUILD_TIMEOUT_MS);
    proc.stdout?.on('data', (chunk: Buffer) => {
      console.debug('[ReticulumSidecar] cargo:', sanitizeLogMessage(chunk.toString('utf8').trim()));
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8');
      stderr += line;
      console.debug('[ReticulumSidecar] cargo:', sanitizeLogMessage(line.trim()));
    });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      settle(() => {
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
    });
    proc.on('exit', (code) => {
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(formatReticulumCargoBuildError(code, stderr)));
      });
    });
  });
}

/** @internal Exported for unit tests (timeout / hang termination). */
export const runCargoBuildForTests = runCargoBuild;

/** Newest mtime among Cargo.toml and reticulum-sidecar/src Rust sources. */
export function newestReticulumSidecarSourceMtimeMs(projectDir: string): number {
  let newest = 0;
  const cargoToml = joinUnderRoot(projectDir, 'Cargo.toml');
  if (fs.existsSync(cargoToml)) {
    newest = Math.max(newest, fs.statSync(cargoToml).mtimeMs);
  }
  const srcDir = joinUnderRoot(projectDir, 'src');
  if (!fs.existsSync(srcDir)) return newest;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = joinUnderRoot(dir, entry.name);
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
  return newestReticulumSidecarSourceMtimeMs(projectDir) > binaryMtime;
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
  lacksRnsStack: boolean;
  lacksRnsBle: boolean;
}): DevSidecarEnsureAction {
  if (opts.missing || opts.stale || opts.lacksRnsStack || opts.lacksRnsBle) return 'await-build';
  return 'noop';
}

async function runDevSidecarCargoBuild(projectDir: string, reason: string): Promise<void> {
  if (!devBuildInFlight) {
    console.debug(`[ReticulumSidecar] ${reason}; running cargo build…`);
    devBuildInFlight = Promise.resolve()
      .then(() => {
        ensureRsReticulumPatches(projectDir);
      })
      .then(() => runCargoBuild(projectDir))
      .finally(() => {
        devBuildInFlight = null;
      });
  }
  await devBuildInFlight;
}

export interface EnsureDevSidecarBinaryOpts {
  /**
   * Override project discovery (tests).
   * Pass `null` to skip discovery (Flatpak / no Rust tree).
   * Omit or pass `undefined` to run `findReticulumSidecarProjectDir()`.
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
        'RETICULUM_SIDECAR_PROJECT_MISSING: reticulum-sidecar/ not found. Run `pnpm run reticulum:sidecar:build` from the mesh-client repo root.',
      );
    }
    throw err;
  }
  if (!st.isFile()) {
    throw new Error(
      `RETICULUM_SIDECAR_BINARY_NOT_EXECUTABLE: expected a regular file at ${binaryPath}`,
    );
  }
  // OS-specific: Windows does not use Unix execute bits the same way.
  if (process.platform === 'win32') return;
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch (err) {
    if (fsErrnoCode(err) === 'EACCES') {
      throw new Error(
        `RETICULUM_SIDECAR_BINARY_NOT_EXECUTABLE: ${binaryPath} exists but is not executable (fix packaging permissions or chmod 755)`,
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
    opts?.projectDir === null ? null : (opts?.projectDir ?? findReticulumSidecarProjectDir());
  if (!projectDir) {
    assertBundledSidecarBinary(binaryPath);
    return;
  }

  const missing = !fs.existsSync(binaryPath);
  const stale = !missing && sidecarBinaryIsStale(binaryPath, projectDir);
  const lacksRnsStack =
    !missing && hasRsstackWorkspace(projectDir) && sidecarBinaryLacksRnsStack(binaryPath);
  const lacksRnsBle =
    !missing && hasRsstackWorkspace(projectDir) && sidecarBinaryLacksRnsBle(binaryPath);
  const action = resolveDevSidecarEnsureAction({ missing, stale, lacksRnsStack, lacksRnsBle });

  if (action === 'noop') {
    return;
  }

  const reason = missing
    ? 'debug binary missing'
    : lacksRnsStack
      ? 'debug binary is stub-only; rebuilding with rns-stack for live peers'
      : lacksRnsBle
        ? 'debug binary lacks rns-ble; rebuilding with BLE interface support'
        : 'sidecar sources newer than binary';
  const runBuild = opts?.runBuild ?? runDevSidecarCargoBuild;
  await runBuild(projectDir, reason);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `RETICULUM_SIDECAR_BINARY_MISSING: expected ${binaryPath} after cargo build. Run \`pnpm run reticulum:sidecar:build\` manually.`,
    );
  }
}
