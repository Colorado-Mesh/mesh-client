import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { AiMlxHelperReason } from '../../../shared/ai-types';
import { isAppleSiliconMac } from '../local/modelManifest';
import { classifyXcodeDeveloperDir, discoverXcodeDeveloperDir } from './discoverXcodeDeveloperDir';

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
  if (existsSync(userBinary)) return userBinary;
  for (const candidate of bundledCandidates) {
    if (existsSync(candidate)) return candidate;
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
  const metalBin = path.join(developer, 'usr', 'bin', 'metal');
  const env = { ...process.env, DEVELOPER_DIR: developer };
  try {
    // `-help` exercises the Metal frontend without compiling; missing toolchain
    // surfaces the same downloadComponent error as a full Swift build.
    await runCommand(metalBin, ['-help'], { env, maxBuffer: 1024 * 1024 });
    return 'ok';
  } catch (error) {
    // catch-no-log-ok classified into return value; ensureMlxHelper logs the final reason
    const text = commandOutputText(error);
    if (isMetalToolchainMissingOutput(text)) return 'metalToolchainMissing';
    // Some toolchains exit non-zero on -help while still being usable; allow build.
    if (existsSync(metalBin) && !isMetalToolchainMissingOutput(text)) return 'unknown';
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
        mkdirSync(path.dirname(paths.userBinary), { recursive: true });
        cpSync(existing, paths.userBinary);
      } catch {
        // catch-no-log-ok keep using bundled path if userData copy fails
        return { available: true, reason: 'ready', binaryPath: existing };
      }
      return { available: true, reason: 'ready', binaryPath: paths.userBinary };
    }
    return { available: true, reason: 'ready', binaryPath: existing };
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
    mkdirSync(path.dirname(paths.userBinary), { recursive: true });
    await fs.copyFile(built, paths.userBinary);
    await fs.chmod(paths.userBinary, 0o755);
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
