import { execFile } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { AiMlxHelperReason } from '../../../shared/ai-types';
import { isAppleSiliconMac } from '../local/modelManifest';
import { classifyXcodeDeveloperDir, discoverXcodeDeveloperDir } from './discoverXcodeDeveloperDir';

/**
 * SwiftPM resource bundles that must sit next to `mesh-ai-mlx` (default.metallib).
 * Keep in sync with `scripts/lib/stage-mlx-helper.mjs`.
 */
export const MLX_HELPER_SIDE_BUNDLES = [
  'mlx-swift_Cmlx.bundle',
  'swift-transformers_Hub.bundle',
  'swift-crypto_Crypto.bundle',
] as const;

/** True when the binary and the Cmlx metallib bundle are present. */
export function isMlxHelperInstallComplete(binaryPath: string): boolean {
  if (!binaryPath || !existsSync(binaryPath)) return false;
  return existsSync(path.join(path.dirname(binaryPath), 'mlx-swift_Cmlx.bundle'));
}

/**
 * Copy `mesh-ai-mlx` and adjacent SwiftPM bundles into the install directory.
 * Without `mlx-swift_Cmlx.bundle`, generate fails with "Failed to load the default metallib".
 */
export function stageMlxHelperBinary(sourceBinary: string, destBinary: string): void {
  const destDir = path.dirname(destBinary);
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceBinary, destBinary);
  chmodSync(destBinary, 0o755);
  const sourceDir = path.dirname(sourceBinary);
  for (const name of MLX_HELPER_SIDE_BUNDLES) {
    const from = path.join(sourceDir, name);
    const to = path.join(destDir, name);
    if (!existsSync(from)) continue;
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}

export type EnsureMlxCommand = (
  file: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface EnsureMlxHelperPaths {
  /** Writable install target (usually `userData/ai-helper/mesh-ai-mlx`). */
  userBinary: string;
  /** Packaged or dev-staged binary candidates (first existing wins as source copy). */
  bundledCandidates: string[];
  /** Repo-relative Swift package root for from-source builds. */
  mlxPackageRoot: string;
  applicationsDir?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  /** Injectable for tests; defaults to promisified `execFile`. */
  runCommand?: EnsureMlxCommand;
}

export interface EnsureMlxHelperResult {
  available: boolean;
  reason: AiMlxHelperReason;
  binaryPath: string | null;
}

export function resolveMlxBinaryPath(
  userBinary: string,
  bundledCandidates: string[],
): string | null {
  if (isMlxHelperInstallComplete(userBinary)) return userBinary;
  for (const candidate of bundledCandidates) {
    if (isMlxHelperInstallComplete(candidate)) return candidate;
  }
  return null;
}

/** True when Apple reports the optional Metal Toolchain component is not installed. */
export function isMetalToolchainMissingOutput(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('missing metal toolchain') ||
    lower.includes('downloadcomponent metaltoolchain') ||
    (lower.includes('metaltoolchain') && lower.includes('cannot execute tool'))
  );
}

function bufferOrString(value: string | Buffer | undefined | null): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : value.toString('utf8');
}

function commandOutputText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const withOutput = error as Error & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return [
      withOutput.message,
      bufferOrString(withOutput.stderr),
      bufferOrString(withOutput.stdout),
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (error && typeof error === 'object') {
    const err = error as {
      message?: unknown;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const message = typeof err.message === 'string' ? err.message : '';
    return [message, bufferOrString(err.stderr), bufferOrString(err.stdout)]
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function logEnsureFailure(reason: AiMlxHelperReason, detail?: string): void {
  console.warn(
    '[ensureMlxHelper] Metal helper unavailable',
    reason,
    detail?.trim() ? detail.trim().slice(0, 500) : '',
  );
}

const defaultRunCommand: EnsureMlxCommand = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], opts, (error, stdout, stderr) => {
      if (error) {
        const failure = error instanceof Error ? error : new Error('Metal helper command failed');
        Object.assign(failure, { stdout, stderr });
        reject(failure);
        return;
      }
      resolve({
        stdout: bufferOrString(stdout),
        stderr: bufferOrString(stderr),
      });
    });
  });

async function probeMetalToolchain(
  developer: string,
  runCommand: EnsureMlxCommand,
): Promise<'ok' | 'metalToolchainMissing' | 'unknown'> {
  const env = { ...process.env, DEVELOPER_DIR: developer };
  try {
    // Prefer `xcrun`: modern Xcode serves metal from a MobileAsset cryptex, so
    // `Developer/usr/bin/metal` often does not exist on disk.
    await runCommand('xcrun', ['-sdk', 'macosx', 'metal', '-v'], {
      env,
      maxBuffer: 1024 * 1024,
    });
    return 'ok';
  } catch (error) {
    // catch-no-log-ok classified into return value; ensureMlxHelper logs the final reason
    const text = commandOutputText(error);
    if (isMetalToolchainMissingOutput(text)) return 'metalToolchainMissing';
    // Non-zero exit without the missing-toolchain signature: still attempt swift build.
    return 'unknown';
  }
}

/**
 * Ensure `mesh-ai-mlx` is usable: prefer existing/user/bundled binary, else build with
 * discovered Xcode (`DEVELOPER_DIR` for the child only — never mutates `xcode-select`).
 */
export async function ensureMlxHelper(paths: EnsureMlxHelperPaths): Promise<EnsureMlxHelperResult> {
  const platform = paths.platform ?? process.platform;
  const arch = paths.arch ?? process.arch;
  const runCommand = paths.runCommand ?? defaultRunCommand;

  if (!isAppleSiliconMac(platform, arch)) {
    return { available: false, reason: 'unsupported', binaryPath: null };
  }

  const existing = resolveMlxBinaryPath(paths.userBinary, paths.bundledCandidates);
  if (existing) {
    if (existing !== paths.userBinary) {
      try {
        stageMlxHelperBinary(existing, paths.userBinary);
      } catch {
        // catch-no-log-ok keep using bundled path if userData copy fails
        return { available: true, reason: 'ready', binaryPath: existing };
      }
      return { available: true, reason: 'ready', binaryPath: paths.userBinary };
    }
    return { available: true, reason: 'ready', binaryPath: existing };
  }

  // Binary without metallib bundles: treat as incomplete and rebuild/restage when possible.
  if (existsSync(paths.userBinary) && !isMlxHelperInstallComplete(paths.userBinary)) {
    console.warn(
      '[ensureMlxHelper] mesh-ai-mlx present but mlx-swift_Cmlx.bundle missing; restaging',
    );
  }

  const applicationsDir = paths.applicationsDir ?? '/Applications';
  const classification = classifyXcodeDeveloperDir(applicationsDir);
  if (classification === 'xcodeNotFound') {
    logEnsureFailure('xcodeNotFound');
    return { available: false, reason: 'xcodeNotFound', binaryPath: null };
  }
  const developer = discoverXcodeDeveloperDir(applicationsDir);
  if (!developer || classification === 'xcodeIncomplete') {
    logEnsureFailure('xcodeIncomplete');
    return { available: false, reason: 'xcodeIncomplete', binaryPath: null };
  }

  if (!existsSync(paths.mlxPackageRoot)) {
    logEnsureFailure('sourcesUnavailable', paths.mlxPackageRoot);
    return { available: false, reason: 'sourcesUnavailable', binaryPath: null };
  }

  const probe = await probeMetalToolchain(developer, runCommand);
  if (probe === 'metalToolchainMissing') {
    logEnsureFailure('metalToolchainMissing');
    return { available: false, reason: 'metalToolchainMissing', binaryPath: null };
  }

  try {
    const env = { ...process.env, DEVELOPER_DIR: developer };
    await runCommand('swift', ['build', '-c', 'release', '--product', 'mesh-ai-mlx'], {
      cwd: paths.mlxPackageRoot,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const built = path.join(paths.mlxPackageRoot, '.build', 'release', 'mesh-ai-mlx');
    if (!existsSync(built)) {
      logEnsureFailure('buildFailed', 'release binary missing after swift build');
      return { available: false, reason: 'buildFailed', binaryPath: null };
    }
    if (!isMlxHelperInstallComplete(built)) {
      logEnsureFailure('buildFailed', 'mlx-swift_Cmlx.bundle missing next to release binary');
      return { available: false, reason: 'buildFailed', binaryPath: null };
    }
    stageMlxHelperBinary(built, paths.userBinary);
    return { available: true, reason: 'ready', binaryPath: paths.userBinary };
  } catch (error) {
    // catch-no-log-ok logged via logEnsureFailure (scanner requires console.* or this marker)
    const text = commandOutputText(error);
    if (isMetalToolchainMissingOutput(text)) {
      logEnsureFailure('metalToolchainMissing', text);
      return { available: false, reason: 'metalToolchainMissing', binaryPath: null };
    }
    logEnsureFailure('buildFailed', text);
    return { available: false, reason: 'buildFailed', binaryPath: null };
  }
}
