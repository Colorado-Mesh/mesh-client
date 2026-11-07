import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AiMlxHelperReason } from '../../../shared/ai-types';
import { isAppleSiliconMac } from '../local/modelManifest';
import { classifyXcodeDeveloperDir, discoverXcodeDeveloperDir } from './discoverXcodeDeveloperDir';

const execFileAsync = promisify(execFile);

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

/**
 * Ensure `mesh-ai-mlx` is usable: prefer existing/user/bundled binary, else build with
 * discovered Xcode (`DEVELOPER_DIR` for the child only — never mutates `xcode-select`).
 */
export async function ensureMlxHelper(paths: EnsureMlxHelperPaths): Promise<EnsureMlxHelperResult> {
  const platform = paths.platform ?? process.platform;
  const arch = paths.arch ?? process.arch;
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
    return { available: false, reason: 'xcodeNotFound', binaryPath: null };
  }
  const developer = discoverXcodeDeveloperDir(applicationsDir);
  if (!developer || classification === 'xcodeIncomplete') {
    return { available: false, reason: 'xcodeIncomplete', binaryPath: null };
  }

  if (!existsSync(paths.mlxPackageRoot)) {
    return { available: false, reason: 'helperMissing', binaryPath: null };
  }

  try {
    const env = { ...process.env, DEVELOPER_DIR: developer };
    await execFileAsync('swift', ['build', '-c', 'release', '--product', 'mesh-ai-mlx'], {
      cwd: paths.mlxPackageRoot,
      env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const built = path.join(paths.mlxPackageRoot, '.build', 'release', 'mesh-ai-mlx');
    if (!existsSync(built)) {
      return { available: false, reason: 'buildFailed', binaryPath: null };
    }
    mkdirSync(path.dirname(paths.userBinary), { recursive: true });
    await fs.copyFile(built, paths.userBinary);
    await fs.chmod(paths.userBinary, 0o755);
    return { available: true, reason: 'ready', binaryPath: paths.userBinary };
  } catch (error) {
    console.warn(
      '[ensureMlxHelper] Metal helper build failed',
      error instanceof Error ? error.message : error,
    );
    return { available: false, reason: 'buildFailed', binaryPath: null };
  }
}
