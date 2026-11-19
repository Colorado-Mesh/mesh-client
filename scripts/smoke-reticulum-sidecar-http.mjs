#!/usr/bin/env node
/**
 * Spawn a reticulum sidecar binary with auth stdin, poll GET /api/v1/status, then stop.
 * Used by packaging CI (staged binary) and AppImage smoke (extracted resources/).
 *
 * Usage:
 *   node scripts/smoke-reticulum-sidecar-http.mjs <path-to-mesh-client-reticulum>
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 250;

/** @param {string} msg */
function fail(msg) {
  console.error(`[smoke-reticulum-sidecar-http] ${msg}`);
  process.exit(1);
}

/** @returns {Promise<number>} */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * @param {string} binaryPath
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function smokeReticulumSidecarHttp(binaryPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? HEALTH_TIMEOUT_MS;
  if (!existsSync(binaryPath)) {
    throw new Error(`sidecar binary not found: ${binaryPath}`);
  }
  // Artifact downloads / AppImage extract may drop +x.
  try {
    chmodSync(binaryPath, 0o755);
  } catch {
    // catch-no-log-ok: chmod may fail on read-only mounts; spawn will surface EACCES
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'mesh-sidecar-smoke-'));
  const configDir = path.join(workDir, 'config');
  const storageDir = path.join(workDir, 'storage');
  const port = await findFreePort();
  const authToken = randomBytes(32).toString('base64url');
  const capabilityIssuerToken = randomBytes(32).toString('base64url');
  const capabilitySessionId = randomBytes(16).toString('base64url');
  const bootstrap = JSON.stringify({
    auth_token: authToken,
    capability_issuer_token: capabilityIssuerToken,
    capability_session_id: capabilitySessionId,
  });

  /** @type {string[]} */
  const outputLines = [];
  const child = spawn(
    binaryPath,
    [
      '--headless',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--reticulum-config-dir',
      configDir,
      '--storage-dir',
      storageDir,
      '--ble-only',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        NO_COLOR: '1',
        RUST_LOG: 'warn',
        ...(process.env.DBUS_SESSION_BUS_ADDRESS
          ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }
          : {}),
        ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
      },
    },
  );

  /** @param {import('node:stream').Readable | null} stream */
  const bindLines = (stream) => {
    if (!stream) return;
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (text) outputLines.push(text);
      }
    });
    stream.on('end', () => {
      const text = buffer.trim();
      if (text) outputLines.push(text);
    });
  };
  bindLines(child.stdout);
  bindLines(child.stderr);

  /** @type {number | null} */
  let exitCode = null;
  /** @type {NodeJS.Signals | null} */
  let exitSignal = null;
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      resolve(undefined);
    });
  });

  child.stdin.on('error', () => {
    // catch-no-log-ok: early child exit may close stdin before end() flushes
  });
  child.stdin.end(`${bootstrap}\n`);

  const url = `http://127.0.0.1:${port}/api/v1/status`;
  const deadline = Date.now() + timeoutMs;
  /** @type {string} */
  let lastError = 'health poll timeout';
  try {
    while (Date.now() < deadline) {
      if (exitCode != null || exitSignal != null) {
        const tail = outputLines.slice(-8).join(' | ');
        throw new Error(
          `sidecar exited code=${exitCode ?? 'null'} signal=${exitSignal ?? 'null'}${
            tail ? `; last output: ${tail}` : ''
          }`,
        );
      }
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${authToken}` },
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) {
          const body = /** @type {{ status?: string }} */ (await res.json());
          if (body.status === 'ok') {
            return { port, outputLines };
          }
          lastError = `unexpected status field: ${body.status}`;
        } else {
          lastError = `status ${res.status}`;
        }
      } catch (err) {
        // catch-no-log-ok: retry until deadline or child exit
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    }
    const tail = outputLines.slice(-8).join(' | ');
    throw new Error(`${lastError}${tail ? `; last output: ${tail}` : ''}`);
  } finally {
    if (exitCode == null && exitSignal == null) {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3_000))]);
      if (exitCode == null && exitSignal == null) {
        child.kill('SIGKILL');
        await exited;
      }
    } else {
      await exited;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const binaryPath = process.argv[2];
  if (!binaryPath) {
    fail('usage: node scripts/smoke-reticulum-sidecar-http.mjs <sidecar-binary>');
  }
  try {
    await smokeReticulumSidecarHttp(path.resolve(binaryPath));
    console.debug(`[smoke-reticulum-sidecar-http] OK — ${binaryPath}`);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
