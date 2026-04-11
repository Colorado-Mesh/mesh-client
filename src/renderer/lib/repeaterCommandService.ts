export interface PendingCommand {
  command: string;
  token: string;
  sentAt: number;
  timeoutMs: number;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  path: Uint8Array[];
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
}

// Base timeout constants - aligned with MeshCore timeouts for consistency
const BASE_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = BASE_TIMEOUT_MS;
const MAX_RETRIES = 5;
const PER_HOP_TIMEOUT_MS = 2000;

export class RepeaterCommandService {
  private nextToken = 0;
  private pendingCommands = new Map<string, PendingCommand>();
  private timeoutMs: number;
  private maxRetries: number;
  private baseTimeoutMs: number;
  private perHopTimeoutMs: number;

  constructor(options: RepeaterCommandServiceOptions = {}) {
    this.timeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.baseTimeoutMs = options.baseTimeoutMs ?? BASE_TIMEOUT_MS;
    this.perHopTimeoutMs = options.perHopTimeoutMs ?? PER_HOP_TIMEOUT_MS;
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
    const hopCount = path.length;
    const dynamicTimeout =
      this.baseTimeoutMs + hopCount * this.perHopTimeoutMs + Math.floor(messageSize / 100) * 100;
    return Math.max(dynamicTimeout, this.timeoutMs);
  }

  registerPendingCommand(
    command: string,
    path: Uint8Array[],
    options?: {
      token?: string;
      timeoutMs?: number;
      maxRetries?: number;
    },
  ): { token: string; promise: Promise<string>; timeoutMs: number } {
    const token = options?.token ?? this.generateToken();
    const timeoutMs = options?.timeoutMs ?? this.calculateTimeout(path, command.length);
    const maxRetries = options?.maxRetries ?? this.maxRetries;

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
      retryCount: 0,
      maxRetries,
      timerId,
    };

    this.pendingCommands.set(token, pending);
    return { token, promise, timeoutMs };
  }

  handleResponse(rawResponse: string): boolean {
    const { token, body } = this.parseResponseToken(rawResponse);
    if (!token) return false;

    const pending = this.pendingCommands.get(token);
    if (!pending) return false;

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
