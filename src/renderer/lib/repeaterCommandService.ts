import { MESHCORE_CLI_REDACTED, redactMeshcoreCliSecretsInText } from '@/shared/meshcoreCliSecrets';

import { serializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';
import { normalizeMeshcoreCliCommand, redactMeshcoreCliSecrets } from './meshcoreRepeaterCliQueue';
import { MESHCORE_REPEATER_REPLY_CAP_MS } from './timeConstants';

export interface PendingCommand {
  command: string;
  token: string;
  /** Monotonic timestamp used only for the remaining reply budget. */
  sentAt: number;
  /** Unix seconds placed on the wire TXT frame (strictly increasing per node). */
  wireTimestampSec: number;
  timeoutMs: number;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  path: Uint8Array[];
  senderNodeId: number;
  retryCount: number;
  maxRetries: number;
  timerId: ReturnType<typeof setTimeout>;
}

export interface CliHistoryEntry {
  type: 'sent' | 'received';
  text: string;
  timestamp: number;
}

export interface RepeaterCommandServiceOptions {
  defaultTimeoutMs?: number;
  maxRetries?: number;
  baseTimeoutMs?: number;
  perHopTimeoutMs?: number;
  maxTimeoutMs?: number;
  /** Injectable clock for wire timestamps (tests). */
  nowSec?: () => number;
}

/** Result of ingesting one wire CLI reply frame into the command service. */
export type MeshcoreCliIngestResult =
  | { kind: 'resolved'; nodeId: number; historyText: string }
  | { kind: 'duplicate' }
  | { kind: 'unmatched'; historyText: string };

interface SettledCliReply {
  senderNodeId: number;
  body: string;
}

/** Floor for direct (0-hop) repeater CLI response wait. */
export const REPEATER_CLI_BASE_TIMEOUT_MS = 30_000;
export const REPEATER_CLI_PER_HOP_TIMEOUT_MS = 2_000;
/** Align multi-hop CLI ceiling with admin receipt-derived reply cap. */
export const REPEATER_CLI_MAX_TIMEOUT_MS = MESHCORE_REPEATER_REPLY_CAP_MS;
/** Max repeater CLI command length before send (BLE to-radio payload cap). */
export const REPEATER_CLI_MAX_COMMAND_LENGTH = 512;

/** Reject a repeater CLI line before it is queued. Returns the normalized command. */
export function assertMeshcoreRepeaterCliCommand(command: string): string {
  const trimmed = normalizeMeshcoreCliCommand(command);
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error(serializeMeshcoreUserMessage('repeatersPanel.cliCommandMustBeSingleLine'));
  }
  if (trimmed.length > REPEATER_CLI_MAX_COMMAND_LENGTH) {
    throw new Error(
      serializeMeshcoreUserMessage({
        key: 'repeatersPanel.cliCommandTooLong',
        params: { max: REPEATER_CLI_MAX_COMMAND_LENGTH },
      }),
    );
  }
  return trimmed;
}

const DEFAULT_TIMEOUT_MS = REPEATER_CLI_BASE_TIMEOUT_MS;
const MAX_RETRIES = 5;

/** Prefer trace hop count when available; otherwise use contact hopsAway. */
export function computeRepeaterCliHopCount(
  hopsAway: number | null | undefined,
  traceHopCount: number | null | undefined,
): number {
  if (traceHopCount != null && traceHopCount >= 0) return traceHopCount;
  return Math.max(0, hopsAway ?? 0);
}

export function calculateRepeaterCliTimeout(
  hopCount: number,
  messageSize = 0,
  options?: Pick<
    RepeaterCommandServiceOptions,
    'baseTimeoutMs' | 'perHopTimeoutMs' | 'maxTimeoutMs'
  >,
): number {
  const baseTimeoutMs = options?.baseTimeoutMs ?? REPEATER_CLI_BASE_TIMEOUT_MS;
  const perHopTimeoutMs = options?.perHopTimeoutMs ?? REPEATER_CLI_PER_HOP_TIMEOUT_MS;
  const maxTimeoutMs = options?.maxTimeoutMs ?? REPEATER_CLI_MAX_TIMEOUT_MS;
  const dynamicTimeout =
    baseTimeoutMs + hopCount * perHopTimeoutMs + Math.floor(messageSize / 100) * 100;
  return Math.min(Math.max(dynamicTimeout, baseTimeoutMs), maxTimeoutMs);
}

/** Extra CLI wait when companion waiting-message drain is (or was) busy. */
export function padRepeaterCliTimeoutForWaitingDrain(
  timeoutMs: number,
  drainBusy: boolean,
  drainPadMs: number,
  maxTimeoutMs = REPEATER_CLI_MAX_TIMEOUT_MS,
): number {
  if (!drainBusy) return timeoutMs;
  return Math.min(maxTimeoutMs, timeoutMs + drainPadMs);
}

function pendingKey(nodeId: number, token: string): string {
  return `${nodeId >>> 0}:${token.toUpperCase()}`;
}

export class RepeaterCommandService {
  private nextToken = 0;
  /** Pending keyed by `${nodeId}:${token}`. */
  private pendingCommands = new Map<string, PendingCommand>();
  /** Keep sensitive token tombstones until reuse so late replies are also redacted. */
  private sensitiveTokens = new Set<string>();
  /**
   * Resolved token→body tombstones until the token is reused. Identical re-deliveries of a
   * just-resolved reply are reported as `duplicate` so CLI history stays single-writer.
   */
  private settled = new Map<string, SettledCliReply>();
  /** Last wire TXT timestamp (unix seconds) per node — firmware treats equal ts as empty retry. */
  private lastCliTimestampByNode = new Map<number, number>();
  private timeoutMs: number;
  private maxRetries: number;
  private baseTimeoutMs: number;
  private perHopTimeoutMs: number;
  private maxTimeoutMs: number;
  private nowSec: () => number;

  constructor(options: RepeaterCommandServiceOptions = {}) {
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.baseTimeoutMs = options.baseTimeoutMs ?? REPEATER_CLI_BASE_TIMEOUT_MS;
    this.perHopTimeoutMs = options.perHopTimeoutMs ?? REPEATER_CLI_PER_HOP_TIMEOUT_MS;
    this.maxTimeoutMs = options.maxTimeoutMs ?? REPEATER_CLI_MAX_TIMEOUT_MS;
    this.nowSec = options.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Allocate a strictly increasing unix-second timestamp for a node's next CLI frame.
   */
  allocateCliTimestamp(nodeId: number): number {
    const id = nodeId >>> 0;
    const wall = this.nowSec();
    const last = this.lastCliTimestampByNode.get(id) ?? 0;
    const next = Math.max(wall, last + 1);
    this.lastCliTimestampByNode.set(id, next);
    return next;
  }

  clearCliTimestamps(): void {
    this.lastCliTimestampByNode.clear();
  }

  /**
   * Fresh 2-hex token for `nodeId`, skipping any token already pending for that node.
   */
  generateToken(nodeId = 0): string {
    const id = nodeId >>> 0;
    for (let i = 0; i < 256; i++) {
      const token = this.nextToken.toString(16).toUpperCase().padStart(2, '0');
      this.nextToken = (this.nextToken + 1) % 256;
      if (!this.pendingCommands.has(pendingKey(id, token))) {
        return token;
      }
    }
    return '00';
  }

  formatCommandWithToken(command: string, token?: string, nodeId = 0): string {
    const t = token ?? this.generateToken(nodeId);
    return `${t}|${command}`;
  }

  parseResponseToken(response: string): { token: string | null; body: string } {
    const match = /^([0-9A-Fa-f]{2})\|(.*)$/s.exec(response);
    if (match) {
      return { token: match[1].toUpperCase(), body: match[2] };
    }
    return { token: null, body: response };
  }

  calculateTimeout(path: Uint8Array[], messageSize = 0): number {
    return calculateRepeaterCliTimeout(path.length, messageSize, {
      baseTimeoutMs: this.baseTimeoutMs,
      perHopTimeoutMs: this.perHopTimeoutMs,
      maxTimeoutMs: this.maxTimeoutMs,
    });
  }

  private lookupPending(token: string, senderNodeId?: number): PendingCommand | undefined {
    const upper = token.toUpperCase();
    if (senderNodeId != null && senderNodeId !== 0) {
      return this.pendingCommands.get(pendingKey(senderNodeId, upper));
    }
    // Ambiguous sender: only match when a single pending entry uses this token.
    let found: PendingCommand | undefined;
    for (const pending of this.pendingCommands.values()) {
      if (pending.token !== upper) continue;
      if (found) return undefined;
      found = pending;
    }
    return found;
  }

  registerPendingCommand(
    command: string,
    path: Uint8Array[],
    options?: {
      token?: string;
      timeoutMs?: number;
      maxRetries?: number;
      senderNodeId?: number;
      wireTimestampSec?: number;
    },
  ): { token: string; promise: Promise<string>; timeoutMs: number; wireTimestampSec: number } {
    const senderNodeId = options?.senderNodeId ?? 0;
    const token = options?.token ?? this.generateToken(senderNodeId);
    const key = pendingKey(senderNodeId, token);
    this.settled.delete(key);
    if (redactMeshcoreCliSecrets(command) !== command) this.sensitiveTokens.add(key);
    else this.sensitiveTokens.delete(key);
    const timeoutMs = options?.timeoutMs ?? this.calculateTimeout(path, command.length);
    const maxRetries = options?.maxRetries ?? this.maxRetries;
    const wireTimestampSec = options?.wireTimestampSec ?? this.allocateCliTimestamp(senderNodeId);

    let resolve!: (response: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timerId = setTimeout(() => {
      if (this.pendingCommands.delete(key)) {
        reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const pending: PendingCommand = {
      command,
      token,
      sentAt: performance.now(),
      wireTimestampSec,
      timeoutMs,
      resolve,
      reject,
      path,
      senderNodeId,
      retryCount: 0,
      maxRetries,
      timerId,
    };

    this.pendingCommands.set(key, pending);
    return { token, promise, timeoutMs, wireTimestampSec };
  }

  /** True when sender is unknown (0/omit) or matches the expected node. */
  private senderMatches(expectedSenderNodeId: number, senderId?: number): boolean {
    if (senderId == null || senderId === 0 || expectedSenderNodeId === 0) return true;
    return expectedSenderNodeId === senderId;
  }

  /** Lengthen an in-flight CLI wait when drain is busy at SENT. */
  extendPendingTimeout(token: string, newTimeoutMs: number, senderNodeId?: number): void {
    const pending = this.lookupPending(token, senderNodeId);
    if (!pending || newTimeoutMs <= pending.timeoutMs) return;
    const key = pendingKey(pending.senderNodeId, pending.token);
    clearTimeout(pending.timerId);
    pending.timeoutMs = newTimeoutMs;
    const remaining = Math.max(0, newTimeoutMs - (performance.now() - pending.sentAt));
    pending.timerId = setTimeout(() => {
      if (this.pendingCommands.delete(key)) {
        pending.reject(new Error(`CLI command timed out after ${newTimeoutMs}ms`));
      }
    }, remaining);
  }

  /**
   * Restart the CLI reply timer from now (after SENT). Use when companion send was delayed
   * behind getWaitingMessages / other radio work so the pre-send timer would otherwise expire.
   */
  restartPendingTimeoutFromNow(token: string, timeoutMs: number, senderNodeId?: number): void {
    const pending = this.lookupPending(token, senderNodeId);
    if (!pending) return;
    const key = pendingKey(pending.senderNodeId, pending.token);
    clearTimeout(pending.timerId);
    pending.sentAt = performance.now();
    pending.timeoutMs = timeoutMs;
    pending.timerId = setTimeout(() => {
      if (this.pendingCommands.delete(key)) {
        pending.reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
  }

  /**
   * Ingest one CLI reply frame. Resolves a pending command, suppresses an identical
   * re-delivery of a just-settled token, or reports unmatched (stray / late / different body).
   */
  ingestResponse(rawResponse: string, senderId?: number): MeshcoreCliIngestResult {
    const { token, body } = this.parseResponseToken(rawResponse);
    const historyText = this.redactResponseForHistory(rawResponse, senderId);

    if (token) {
      const pending = this.lookupPending(token, senderId);
      if (pending && this.senderMatches(pending.senderNodeId, senderId)) {
        const key = pendingKey(pending.senderNodeId, pending.token);
        clearTimeout(pending.timerId);
        this.pendingCommands.delete(key);
        this.settled.set(key, { senderNodeId: pending.senderNodeId, body });
        pending.resolve(body);
        return {
          kind: 'resolved',
          nodeId: pending.senderNodeId,
          historyText,
        };
      }

      const settledKey =
        senderId != null && senderId !== 0
          ? pendingKey(senderId, token)
          : [...this.settled.keys()].find((k) => k.endsWith(`:${token.toUpperCase()}`));
      if (settledKey) {
        const prior = this.settled.get(settledKey);
        if (prior?.body === body && this.senderMatches(prior.senderNodeId, senderId)) {
          return { kind: 'duplicate' };
        }
      }
    }

    return { kind: 'unmatched', historyText };
  }

  /** Resolve-or-not wrapper around {@link ingestResponse} for call sites that only need a boolean. */
  handleResponse(rawResponse: string, senderId?: number): boolean {
    return this.ingestResponse(rawResponse, senderId).kind === 'resolved';
  }

  redactResponseForHistory(rawResponse: string, senderId?: number): string {
    const { token, body } = this.parseResponseToken(rawResponse);
    const key =
      token && senderId != null && senderId !== 0
        ? pendingKey(senderId, token)
        : token
          ? [...this.sensitiveTokens].find((k) => k.endsWith(`:${token}`))
          : undefined;
    return (key && this.sensitiveTokens.has(key)) || /^password now:/i.test(body.trim())
      ? MESHCORE_CLI_REDACTED
      : redactMeshcoreCliSecretsInText(body);
  }

  handleError(token: string, error: Error, senderNodeId?: number): boolean {
    const pending = this.lookupPending(token, senderNodeId);
    if (!pending) return false;

    pending.retryCount++;
    const key = pendingKey(pending.senderNodeId, pending.token);
    if (pending.retryCount >= pending.maxRetries) {
      clearTimeout(pending.timerId);
      this.pendingCommands.delete(key);
      pending.reject(error);
      return true;
    }

    return false;
  }

  /** Reject and remove a pending command without retry (send failed before reply window). */
  rejectPending(token: string, error: Error, senderNodeId?: number): boolean {
    const pending = this.lookupPending(token, senderNodeId);
    if (!pending) return false;
    const key = pendingKey(pending.senderNodeId, pending.token);
    clearTimeout(pending.timerId);
    this.pendingCommands.delete(key);
    pending.reject(error);
    return true;
  }

  getPendingCommand(token: string, senderNodeId?: number): PendingCommand | undefined {
    return this.lookupPending(token, senderNodeId);
  }

  hasPendingCommand(token: string, senderNodeId?: number): boolean {
    return this.lookupPending(token, senderNodeId) != null;
  }

  /** @deprecated Timeouts are now self-managed via internal setTimeout in registerPendingCommand. */
  clearTimeouts(): void {
    // no-op: each pending command self-rejects via its own setTimeout
  }

  clear(): void {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timerId);
      pending.reject(new Error('CLI command cancelled'));
    }
    this.pendingCommands.clear();
    this.settled.clear();
    this.lastCliTimestampByNode.clear();
  }
}

export function createRepeaterCommandService(
  options?: RepeaterCommandServiceOptions,
): RepeaterCommandService {
  return new RepeaterCommandService(options);
}
