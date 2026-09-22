/**
 * Durable audit log for received MECP (emergency) messages.
 * Survives app restarts; not wiped by session `mesh-client.log` promote.
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { sanitizeLogMessage } from './sanitize-log-message';

export const MECP_RECEIVED_LOG_FILENAME = 'mecp-received.log';
export const MECP_RECEIVED_LOG_BACKUP_FILENAME = 'mecp-received.log.1';
const MECP_RECEIVED_LOG_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_FIELD_CHARS = 2000;

export interface MecpReceivedLogEntry {
  ts?: string;
  protocol: string;
  severity: number | null;
  drill: boolean;
  from?: string;
  channel?: number | string;
  payload: string;
  decoded?: string;
  direction?: 'received' | 'rebroadcast';
  toProtocol?: string;
  toChannel?: number | string;
  bidirectional?: boolean;
  messageId?: string;
}

let logFilePath: string | null = null;
let appendChain: Promise<void> = Promise.resolve();

export function getMecpReceivedLogPath(): string {
  if (!logFilePath) {
    logFilePath = path.join(app.getPath('userData'), MECP_RECEIVED_LOG_FILENAME);
  }
  return logFilePath;
}

/** @internal Test helper */
export function setMecpReceivedLogPathForTests(p: string | null): void {
  logFilePath = p;
}

function clampField(value: string | number): string {
  const sanitized = sanitizeLogMessage(typeof value === 'string' ? value : String(value));
  return sanitized.length > MAX_FIELD_CHARS ? sanitized.slice(0, MAX_FIELD_CHARS) : sanitized;
}

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const { size } = fs.statSync(filePath);
    if (size < MECP_RECEIVED_LOG_MAX_BYTES) return;
    const backup = path.join(path.dirname(filePath), MECP_RECEIVED_LOG_BACKUP_FILENAME);
    if (fs.existsSync(backup)) {
      fs.unlinkSync(backup);
    }
    fs.renameSync(filePath, backup);
  } catch (e) {
    console.warn(
      '[mecp-received-log] rotate failed',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
}

export function formatMecpReceivedLogLine(entry: MecpReceivedLogEntry): string {
  const record = {
    ts: entry.ts ?? new Date().toISOString(),
    protocol: clampField(entry.protocol),
    severity: entry.severity,
    drill: entry.drill,
    from: entry.from != null ? clampField(entry.from) : undefined,
    channel: entry.channel != null ? clampField(entry.channel) : undefined,
    payload: clampField(entry.payload),
    decoded: entry.decoded != null ? clampField(entry.decoded) : undefined,
    direction: entry.direction ?? 'received',
    toProtocol: entry.toProtocol != null ? clampField(entry.toProtocol) : undefined,
    toChannel: entry.toChannel != null ? clampField(entry.toChannel) : undefined,
    bidirectional: entry.bidirectional,
    messageId: entry.messageId != null ? clampField(entry.messageId) : undefined,
  };
  return `${JSON.stringify(record)}\n`;
}

export function appendMecpReceivedLog(entry: MecpReceivedLogEntry): void {
  const filePath = getMecpReceivedLogPath();
  const line = formatMecpReceivedLogLine(entry);
  appendChain = appendChain
    .then(async () => {
      rotateIfNeeded(filePath);
      await fs.promises.appendFile(filePath, line, 'utf8');
    })
    .catch((e: unknown) => {
      console.warn(
        '[mecp-received-log] append failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    });
}

export async function readMecpReceivedLogForExport(): Promise<string> {
  const filePath = getMecpReceivedLogPath();
  const backup = path.join(path.dirname(filePath), MECP_RECEIVED_LOG_BACKUP_FILENAME);
  const parts: string[] = [];
  try {
    if (fs.existsSync(backup)) {
      parts.push(await fs.promises.readFile(backup, 'utf8'));
    }
  } catch {
    // catch-no-log-ok missing backup is fine
  }
  try {
    if (fs.existsSync(filePath)) {
      parts.push(await fs.promises.readFile(filePath, 'utf8'));
    }
  } catch {
    // catch-no-log-ok missing current is fine
  }
  return parts.join('');
}

export function isValidMecpAppendPayload(raw: unknown): raw is MecpReceivedLogEntry {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.protocol !== 'string' || o.protocol.length === 0 || o.protocol.length > 32) {
    return false;
  }
  if (
    typeof o.payload !== 'string' ||
    o.payload.length === 0 ||
    o.payload.length > MAX_FIELD_CHARS
  ) {
    return false;
  }
  if (typeof o.drill !== 'boolean') return false;
  if (o.severity != null && (typeof o.severity !== 'number' || o.severity < 0 || o.severity > 3)) {
    return false;
  }
  return true;
}
