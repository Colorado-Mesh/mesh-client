export interface PendingCommand {
  command: string;
  token: string;
  sentAt: number;
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
}

/** Floor for direct (0-hop) repeater CLI response wait. */
export const REPEATER_CLI_BASE_TIMEOUT_MS = 30_000;
export const REPEATER_CLI_PER_HOP_TIMEOUT_MS = 2_000;
/** Align multi-hop CLI ceiling with flat admin RPC timeouts. */
export const REPEATER_CLI_MAX_TIMEOUT_MS = 120_000;
/** Max repeater CLI command length before send (align with credential IPC limit). */
export const REPEATER_CLI_MAX_COMMAND_LENGTH = 512;

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

export class RepeaterCommandService {
  private nextToken = 0;
  private pendingCommands = new Map<string, PendingCommand>();
  private timeoutMs: number;
  private maxRetries: number;
  private baseTimeoutMs: number;
  private perHopTimeoutMs: number;
  private maxTimeoutMs: number;

  constructor(options: RepeaterCommandServiceOptions = {}) {
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.baseTimeoutMs = options.baseTimeoutMs ?? REPEATER_CLI_BASE_TIMEOUT_MS;
    this.perHopTimeoutMs = options.perHopTimeoutMs ?? REPEATER_CLI_PER_HOP_TIMEOUT_MS;
    this.maxTimeoutMs = options.maxTimeoutMs ?? REPEATER_CLI_MAX_TIMEOUT_MS;
  }

  generateToken(): string {
    const token = this.nextToken.toString(16).toUpperCase().padStart(2, '0');
    this.nextToken = (this.nextToken + 1) % 256;
    return token;
  }

  formatCommandWithToken(command: string, token?: string): string {
    const t = token ?? this.generateToken();
    return `${t}|${command}`;
  }

  parseResponseToken(response: string): { token: string | null; body: string } {
    const match = /^([0-9A-Fa-f]{2})\|(.*)$/.exec(response);
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

  registerPendingCommand(
    command: string,
    path: Uint8Array[],
    options?: {
      token?: string;
      timeoutMs?: number;
      maxRetries?: number;
      senderNodeId?: number;
    },
  ): { token: string; promise: Promise<string>; timeoutMs: number } {
    const token = options?.token ?? this.generateToken();
    const timeoutMs = options?.timeoutMs ?? this.calculateTimeout(path, command.length);
    const maxRetries = options?.maxRetries ?? this.maxRetries;
    const senderNodeId = options?.senderNodeId ?? 0;

    let resolve!: (response: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timerId = setTimeout(() => {
      if (this.pendingCommands.delete(token)) {
        reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const pending: PendingCommand = {
      command,
      token,
      sentAt: Date.now(),
      timeoutMs,
      resolve,
      reject,
      path,
      senderNodeId,
      retryCount: 0,
      maxRetries,
      timerId,
    };

    this.pendingCommands.set(token, pending);
    return { token, promise, timeoutMs };
  }

  handleResponse(rawResponse: string, senderId?: number): boolean {
    const { token, body } = this.parseResponseToken(rawResponse);
    if (!token) return false;

    const pending = this.pendingCommands.get(token);
    if (!pending) return false;

    if (
      senderId != null &&
      senderId !== 0 &&
      pending.senderNodeId !== 0 &&
      pending.senderNodeId !== senderId
    ) {
      return false;
    }

    clearTimeout(pending.timerId);
    this.pendingCommands.delete(token);
    pending.resolve(body);
    return true;
  }

  handleError(token: string, error: Error): boolean {
    const pending = this.pendingCommands.get(token);
    if (!pending) return false;

    pending.retryCount++;
    if (pending.retryCount >= pending.maxRetries) {
      clearTimeout(pending.timerId);
      this.pendingCommands.delete(token);
      pending.reject(error);
      return true;
    }

    return false;
  }

  getPendingCommand(token: string): PendingCommand | undefined {
    return this.pendingCommands.get(token);
  }

  hasPendingCommand(token: string): boolean {
    return this.pendingCommands.has(token);
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
  }
}

export function createRepeaterCommandService(
  options?: RepeaterCommandServiceOptions,
): RepeaterCommandService {
  return new RepeaterCommandService(options);
}
