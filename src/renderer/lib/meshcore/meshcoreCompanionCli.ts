import { sanitizeLogMessage } from '@/main/sanitize-log-message';
import {
  isMeshcoreCliSecretCommand,
  MESHCORE_CLI_REDACTED,
  redactMeshcoreCliSecretCommand,
} from '@/shared/meshcoreCliSecrets';

import { MC_CMD_RUN_CLI_COMMAND, MC_RESP_CLI_REPLY } from '../meshcoreWireCodes';

/** Companion protocol version (`deviceQuery().firmwareVer`) that added CMD_RUN_CLI_COMMAND. */
export const MESHCORE_COMPANION_CLI_MIN_VER = 14;

export const MESHCORE_COMPANION_CLI_TIMEOUT_MS = 8_000;

/**
 * Firmware copies the frame into a fixed buffer and the reply into `reply_buf[166]`; keep
 * commands comfortably under one companion frame including the reflected `xx|` prefix.
 */
export const MESHCORE_COMPANION_CLI_MAX_COMMAND_BYTES = 150;

const UNKNOWN_COMMAND = 'Unknown command';

export interface MeshcoreCompanionCliConnection {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  sendToRadioFrame(data: Uint8Array): Promise<void>;
}

export type MeshcoreCompanionCliResult =
  { kind: 'ok'; reply: string } | { kind: 'unsupported'; reply: string };

export interface RunMeshcoreCompanionCliOptions {
  timeoutMs?: number;
  /** For `reboot` / `poweroff`: resolve once the frame is written; the radio never replies. */
  expectNoReply?: boolean;
  /** Test hook for deterministic prefixes. */
  randomPrefix?: () => string;
}

/** Commands whose arguments or reply text must never be logged (WiFi password, BLE PIN). */
export function isMeshcoreCompanionSensitiveCommand(command: string): boolean {
  return isMeshcoreCliSecretCommand(command);
}

/** Loggable, sanitized form of a companion CLI exchange; secrets are replaced. */
export function formatMeshcoreCompanionCliForLog(command: string, reply?: string): string {
  const sensitive = isMeshcoreCompanionSensitiveCommand(command);
  const cmd = redactMeshcoreCliSecretCommand(command);
  const out = reply === undefined ? cmd : `${cmd} -> ${sensitive ? MESHCORE_CLI_REDACTED : reply}`;
  return sanitizeLogMessage(out);
}

export function isMeshcoreCompanionCliSupported(firmwareVer: number | null | undefined): boolean {
  return (
    typeof firmwareVer === 'number' &&
    Number.isFinite(firmwareVer) &&
    firmwareVer >= MESHCORE_COMPANION_CLI_MIN_VER
  );
}

/** meshcore.js DeviceInfo `firmwareVer` (companion protocol version), or null. */
export function meshcoreCompanionProtocolVersionFromDeviceQuery(info: unknown): number | null {
  if (info == null || typeof info !== 'object') return null;
  const v = (info as { firmwareVer?: unknown }).firmwareVer;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

export function randomMeshcoreCliPrefix(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/**
 * Throws when the command cannot be sent safely as a single companion CLI line. Only leading
 * whitespace is dropped: trailing spaces can be part of a WiFi password.
 */
export function validateMeshcoreCompanionCliCommand(command: string): string {
  const trimmed = command.replace(/^\s+/, '');
  if (trimmed.trim().length === 0) throw new Error('empty companion CLI command');
  if (/[\r\n\0]/.test(trimmed)) throw new Error('companion CLI command must be a single line');
  if (new TextEncoder().encode(trimmed).length > MESHCORE_COMPANION_CLI_MAX_COMMAND_BYTES) {
    throw new Error('companion CLI command too long');
  }
  return trimmed;
}

export function buildRunCliCommandFrame(command: string, prefix: string): Uint8Array {
  if (!/^[a-z0-9]{2}$/.test(prefix)) throw new Error(`invalid CLI prefix: ${prefix}`);
  const text = new TextEncoder().encode(
    `${prefix}|${validateMeshcoreCompanionCliCommand(command)}`,
  );
  const frame = new Uint8Array(1 + text.length);
  frame[0] = MC_CMD_RUN_CLI_COMMAND;
  frame.set(text, 1);
  return frame;
}

/** Returns the reply text for a RESP_CODE_CLI_REPLY frame carrying `prefix`, else null. */
export function matchCliReplyFrame(frame: Uint8Array, prefix: string): string | null {
  if (frame.length < 1 || frame[0] !== MC_RESP_CLI_REPLY) return null;
  const text = new TextDecoder().decode(frame.subarray(1));
  const tag = `${prefix}|`;
  if (!text.startsWith(tag)) return null;
  return text.slice(tag.length);
}

/** Strip the firmware's `> ` value marker (e.g. `> 1` → `1`). */
export function stripCliValueMarker(reply: string): string {
  const trimmed = reply.trim();
  return trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
}

export function classifyCliReply(reply: string): MeshcoreCompanionCliResult {
  return reply.trim() === UNKNOWN_COMMAND ? { kind: 'unsupported', reply } : { kind: 'ok', reply };
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return Uint8Array.from(value);
  }
  return null;
}

const queues = new WeakMap<object, Promise<unknown>>();

/**
 * Run one local companion CLI command (CMD 66 → RESP 29). Calls on the same connection are
 * serialized so concurrent settings reads cannot interleave on the radio's single reply buffer.
 */
export function runMeshcoreCompanionCli(
  conn: MeshcoreCompanionCliConnection,
  command: string,
  opts: RunMeshcoreCompanionCliOptions = {},
): Promise<MeshcoreCompanionCliResult> {
  const prev = queues.get(conn) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // catch-no-log-ok previous command already rejected to its caller
    .then(() => runOnce(conn, command, opts));
  queues.set(conn, next);
  return next;
}

function runOnce(
  conn: MeshcoreCompanionCliConnection,
  command: string,
  opts: RunMeshcoreCompanionCliOptions,
): Promise<MeshcoreCompanionCliResult> {
  const prefix = (opts.randomPrefix ?? randomMeshcoreCliPrefix)();
  const frame = buildRunCliCommandFrame(command, prefix);
  if (opts.expectNoReply) {
    return conn.sendToRadioFrame(frame).then(() => ({ kind: 'ok', reply: '' }));
  }
  const timeoutMs = opts.timeoutMs ?? MESHCORE_COMPANION_CLI_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.off('rx', onRx);
      fn();
    };
    const onRx = (raw: unknown): void => {
      const bytes = toUint8Array(raw);
      if (!bytes) return;
      const reply = matchCliReplyFrame(bytes, prefix);
      if (reply === null) return;
      finish(() => {
        resolve(classifyCliReply(reply));
      });
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error('companion CLI command timed out'));
      });
    }, timeoutMs);
    conn.on('rx', onRx);
    conn.sendToRadioFrame(frame).catch((err: unknown) => {
      finish(() => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  });
}
