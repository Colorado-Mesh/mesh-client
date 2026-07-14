import { type ChildProcess, spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { ReticulumConfigValidateResult } from '../shared/reticulum-types';
import { sanitizeLogMessage } from './log-service';
import { sidecarChildEnv } from './reticulum-sidecar-manager';
import { ensureDevSidecarBinary, resolveSidecarBinaryPath } from './reticulum-sidecar-path';

const VALIDATE_TIMEOUT_MS = 30_000;
/** Cap stdout/stderr so a hung/noisy binary cannot inflate main-process memory. */
const VALIDATE_IO_CAP_BYTES = 2 * 1024 * 1024;
const VALIDATE_MAX_ISSUES = 200;
const VALIDATE_MAX_MESSAGE_CHARS = 2_000;
const VALIDATE_KILL_ESCALATE_MS = 2_000;

let validateInFlight: Promise<ReticulumConfigValidateResult> | null = null;

export function reticulumUserConfigDir(): string {
  return path.join(app.getPath('userData'), 'reticulum', 'config');
}

function killProc(proc: ChildProcess): void {
  try {
    if (proc.killed) return;
    if (process.platform === 'win32') {
      proc.kill();
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // catch-no-log-ok: best-effort kill after validate timeout
  }
  setTimeout(() => {
    try {
      if (!proc.killed) {
        if (process.platform === 'win32') {
          proc.kill();
        } else {
          proc.kill('SIGKILL');
        }
      }
    } catch {
      // catch-no-log-ok: process may already be gone during forced shutdown
    }
  }, VALIDATE_KILL_ESCALATE_MS);
}

function appendCapped(current: string, chunk: Buffer, onOverflow: () => void): string {
  if (current.length >= VALIDATE_IO_CAP_BYTES) {
    onOverflow();
    return current;
  }
  const next = current + chunk.toString('utf8');
  if (next.length > VALIDATE_IO_CAP_BYTES) {
    onOverflow();
    return next.slice(0, VALIDATE_IO_CAP_BYTES);
  }
  return next;
}

function normalizeIssues(
  raw: ReticulumConfigValidateResult['issues'] | undefined,
): ReticulumConfigValidateResult['issues'] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, VALIDATE_MAX_ISSUES).map((issue) => ({
    kind: (issue.kind ?? '').slice(0, 128),
    severity: (issue.severity ?? 'warning').slice(0, 32),
    interface_id:
      typeof issue.interface_id === 'string'
        ? sanitizeLogMessage(issue.interface_id).slice(0, 128)
        : (issue.interface_id ?? null),
    interface_name:
      typeof issue.interface_name === 'string'
        ? sanitizeLogMessage(issue.interface_name).slice(0, 256)
        : (issue.interface_name ?? null),
    message: sanitizeLogMessage(issue.message ?? '').slice(0, VALIDATE_MAX_MESSAGE_CHARS),
    repair_kind:
      typeof issue.repair_kind === 'string'
        ? issue.repair_kind.slice(0, 64)
        : (issue.repair_kind ?? null),
  }));
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
  if (validateInFlight) {
    return validateInFlight;
  }
  validateInFlight = validateReticulumUserConfigImpl(opts).finally(() => {
    validateInFlight = null;
  });
  return validateInFlight;
}

async function validateReticulumUserConfigImpl(opts?: {
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
      env: sidecarChildEnv(),
    });

    let stdout = '';
    let stderr = '';
    let ioOverflow = false;
    const onOverflow = () => {
      if (ioOverflow) return;
      ioOverflow = true;
      killProc(proc);
      settle({
        ok: false,
        issues: [],
        error: 'validate-config output exceeded size limit',
      });
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk, onOverflow);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, onOverflow);
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
      if (ioOverflow) return;
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
        const parseError =
          typeof parsed.parse_error === 'string'
            ? sanitizeLogMessage(parsed.parse_error)
            : undefined;
        const ok = parsed.ok === true;
        settle({
          ok,
          issues: normalizeIssues(parsed.issues),
          parseError,
          error:
            ok || parseError
              ? undefined
              : sanitizeLogMessage(
                  stderr.trim() ||
                    (code != null && code !== 0
                      ? `validate-config exited with code ${code}`
                      : 'validate-config reported failure'),
                ),
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
