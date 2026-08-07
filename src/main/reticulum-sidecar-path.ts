import { spawn, spawnSync } from 'child_process';
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

  try {
    const appBundled = path.join(app.getAppPath(), 'resources', 'reticulum-sidecar', name);
    if (fs.existsSync(appBundled)) return appBundled;
  } catch {
    // catch-no-log-ok app path unavailable in unit tests without electron ready
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

export function hasRnsStackSiblings(projectDir: string): boolean {
  const rnsRuntime = path.normalize(
    path.join(projectDir, '../.rsstack/rsReticulum/crates/rns-runtime/Cargo.toml'),
  );
  const lxmfCore = path.normalize(
    path.join(projectDir, '../.rsstack/rsLXMF/crates/lxmf-core/Cargo.toml'),
  );
  return fs.existsSync(rnsRuntime) && fs.existsSync(lxmfCore);
}

/** Cargo build args: full RNS stack (+ BLE) when the repo-local .rsstack is present. */
export function sidecarCargoBuildArgs(projectDir: string): string[] {
  if (hasRnsStackSiblings(projectDir)) {
    return ['build', '--features', 'rns-stack,rns-ble,rns-rnode-tcp'];
  }
  return ['build'];
}

/** Stub sidecar builds omit rsReticulum symbols needed for live path-table peers. */
export function sidecarBinaryLacksRnsStack(binaryPath: string): boolean {
  try {
    const bytes = fs.readFileSync(binaryPath);
    return !bytes.includes(Buffer.from('rns_runtime'));
  } catch {
    // catch-no-log-ok binary missing or unreadable — treat as stub build
    return true;
  }
}

/** Sidecars built without `rns-ble` embed this availability stub string. */
export function sidecarBinaryLacksRnsBle(binaryPath: string): boolean {
  try {
    const bytes = fs.readFileSync(binaryPath);
    return bytes.includes(Buffer.from('rns-ble feature not enabled in this build'));
  } catch {
    // catch-no-log-ok binary missing or unreadable — treat as no BLE support
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
  return path.join(
    reticulumSidecarRepoRoot(projectDir),
    'scripts',
    'ensure-rsReticulum-patches.sh',
  );
}

/** Apply rsReticulum overlays when the repo-local .rsstack workspace exists (no-op for stub builds). */
export function ensureRsReticulumPatches(projectDir: string): void {
  if (!hasRnsStackSiblings(projectDir)) return;

  const repoRoot = reticulumSidecarRepoRoot(projectDir);
  const scriptPath = ensureRsReticulumPatchesScriptPath(projectDir);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(
      `RETICULUM_RNS_PATCH_SCRIPT_MISSING: expected ${scriptPath}. Run \`pnpm run reticulum:sidecar:build\` from the mesh-client repo root.`,
    );
  }

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
      reject(new Error(formatReticulumCargoBuildError(code, stderr)));
    });
  });
}

/** Newest mtime among Cargo.toml and reticulum-sidecar/src Rust sources. */
export function newestReticulumSidecarSourceMtimeMs(projectDir: string): number {
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
  return newestReticulumSidecarSourceMtimeMs(projectDir) > binaryMtime;
}

export type DevSidecarEnsureAction = 'await-build' | 'background-build' | 'noop';

/**
 * Decide whether connect must wait on cargo, can refresh in the background, or skip.
 * Missing / featureless binaries block; mtime-stale full-feature binaries do not.
 */
export function resolveDevSidecarEnsureAction(opts: {
  missing: boolean;
  stale: boolean;
  lacksRnsStack: boolean;
  lacksRnsBle: boolean;
}): DevSidecarEnsureAction {
  if (opts.missing || opts.lacksRnsStack || opts.lacksRnsBle) return 'await-build';
  if (opts.stale) return 'background-build';
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

/** Dev-only: compile the sidecar when the debug binary is missing or unusable. */
export async function ensureDevSidecarBinary(binaryPath: string): Promise<void> {
  if (app.isPackaged) return;

  const projectDir = findReticulumSidecarProjectDir();
  if (!projectDir) {
    throw new Error(
      'RETICULUM_SIDECAR_PROJECT_MISSING: reticulum-sidecar/ not found. Run `pnpm run reticulum:sidecar:build` from the mesh-client repo root.',
    );
  }

  const missing = !fs.existsSync(binaryPath);
  const stale = !missing && sidecarBinaryIsStale(binaryPath, projectDir);
  const lacksRnsStack =
    !missing && hasRnsStackSiblings(projectDir) && sidecarBinaryLacksRnsStack(binaryPath);
  const lacksRnsBle =
    !missing && hasRnsStackSiblings(projectDir) && sidecarBinaryLacksRnsBle(binaryPath);
  const action = resolveDevSidecarEnsureAction({ missing, stale, lacksRnsStack, lacksRnsBle });

  if (action === 'noop') {
    return;
  }
  if (action === 'background-build') {
    // Prefer availability: start TCP/LXMF/RRC on the existing binary while cargo
    // refreshes in the background for the next start.
    void runDevSidecarCargoBuild(
      projectDir,
      'sidecar sources newer than binary (background refresh)',
    ).catch((e: unknown) => {
      console.warn(
        '[ReticulumSidecar] background cargo rebuild failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    });
    return;
  }

  if (missing) {
    await runDevSidecarCargoBuild(projectDir, 'debug binary missing');
  } else if (lacksRnsStack) {
    await runDevSidecarCargoBuild(
      projectDir,
      'debug binary is stub-only; rebuilding with rns-stack for live peers',
    );
  } else if (lacksRnsBle) {
    await runDevSidecarCargoBuild(
      projectDir,
      'debug binary lacks rns-ble; rebuilding with BLE interface support',
    );
  }

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `RETICULUM_SIDECAR_BINARY_MISSING: expected ${binaryPath} after cargo build. Run \`pnpm run reticulum:sidecar:build\` manually.`,
    );
  }
}
