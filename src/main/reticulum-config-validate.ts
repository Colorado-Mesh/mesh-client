import { type ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { ReticulumConfigValidateResult } from '../shared/reticulum-types';
import { sanitizeLogMessage } from './log-service';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './reticulum-sidecar-path';

const VALIDATE_TIMEOUT_MS = 30_000;

export function reticulumUserConfigDir(): string {
  return path.join(app.getPath('userData'), 'reticulum', 'config');
}

function killProc(proc: ChildProcess): void {
  try {
    if (!proc.killed) {
      proc.kill();
    }
  } catch {
    // catch-no-log-ok: best-effort kill after validate timeout
  }
}

/**
 * One-shot offline lint of the mesh-client Reticulum INI using the bundled sidecar.
 * Safe to run while the long-lived sidecar is up (read-only; no HTTP bind).
 */
export async function validateReticulumUserConfig(opts?: {
  configDir?: string;
  binaryPath?: string;
  timeoutMs?: number;
}): Promise<ReticulumConfigValidateResult> {
  const configDir = opts?.configDir ?? reticulumUserConfigDir();
  const timeoutMs = opts?.timeoutMs ?? VALIDATE_TIMEOUT_MS;
  const binary = opts?.binaryPath ?? resolveSidecarBinaryPath();
  try {
    await ensureDevSidecarBinary(binary);
  } catch (err) {
    // catch-no-log-ok: surfaced to caller via result.error for Network Check config UI
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [],
      error: sanitizeLogMessage(message),
    };
  }
  if (!fs.existsSync(binary)) {
    const msg = app.isPackaged
      ? `RETICULUM_SIDECAR_BUNDLED_MISSING: packaged sidecar binary not found at ${binary}`
      : `Reticulum sidecar binary not found: ${binary}. Run \`pnpm run reticulum:sidecar:build\`.`;
    return { ok: false, issues: [], error: sanitizeLogMessage(msg) };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (result: ReticulumConfigValidateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const proc = spawn(binary, ['validate-config', '--reticulum-config-dir', configDir, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      killProc(proc);
      settle({
        ok: false,
        issues: [],
        error: 'validate-config timed out',
      });
    }, timeoutMs);

    proc.on('error', (err) => {
      settle({
        ok: false,
        issues: [],
        error: sanitizeLogMessage(err.message),
      });
    });

    proc.on('close', (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        settle({
          ok: false,
          issues: [],
          error: sanitizeLogMessage(
            stderr.trim() || `validate-config exited ${code ?? 'unknown'} with empty output`,
          ),
        });
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as {
          ok?: boolean;
          issues?: ReticulumConfigValidateResult['issues'];
          parse_error?: string;
        };
        settle({
          ok: parsed.ok === true,
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
          parseError:
            typeof parsed.parse_error === 'string'
              ? sanitizeLogMessage(parsed.parse_error)
              : undefined,
          error:
            parsed.ok === true || parsed.parse_error
              ? undefined
              : code === 0
                ? undefined
                : undefined,
        });
      } catch (e) {
        // catch-no-log-ok: malformed sidecar JSON returned to caller as result.error
        settle({
          ok: false,
          issues: [],
          error: sanitizeLogMessage(
            e instanceof Error
              ? e.message
              : `invalid validate-config JSON: ${trimmed.slice(0, 200)}`,
          ),
        });
      }
    });
  });
}
