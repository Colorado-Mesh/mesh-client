import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline';

import type { AiOsAiStatus } from '../../../shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, AI_REQUEST_TIMEOUT_MS } from '../../../shared/ai-types';
import { MS_PER_SECOND } from '../../../shared/timeConstants';
import { AiFailure } from '../errors';

interface Reply {
  type: string;
  requestId?: string;
  text?: string;
  available?: boolean;
  modelLabel?: string;
}
export class OsAiHelper {
  private process: ChildProcessWithoutNullStreams | null = null;
  private cached: AiOsAiStatus | undefined;
  private reader: ReturnType<typeof createInterface> | null = null;
  private listeners = new Set<(reply: Reply) => void>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly binary: () => string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}
  private platformId() {
    return this.platform === 'darwin'
      ? ('apple-foundation-models' as const)
      : this.platform === 'win32'
        ? ('windows-ai-foundry' as const)
        : null;
  }
  private start(): void {
    clearTimeout(this.idle);
    if (this.process) return;
    if (!this.platformId() || !fs.existsSync(this.binary())) throw new AiFailure('engineNotReady');
    const child = spawn(this.binary(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.process = child;
    // Native stderr may contain user content. Drain without retaining or logging it.
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    this.reader = lines;
    let bytes = 0;
    child.stdout.on('data', (data: Buffer) => {
      if (this.process !== child) return;
      bytes += data.length;
      if (bytes > AI_MAX_RESPONSE_BYTES) this.kill();
    });
    lines.on('line', (line) => {
      if (this.process !== child) return;
      try {
        const reply: unknown = JSON.parse(line);
        if (reply && typeof reply === 'object' && 'type' in reply && typeof reply.type === 'string')
          for (const listener of this.listeners) listener(reply as Reply);
      } catch {
        // catch-no-log-ok malformed native output is a fixed failure
        this.kill();
      }
    });
    const exit = () => {
      if (this.process === child) {
        this.process = null;
        for (const listener of this.listeners) listener({ type: 'error' });
      }
      lines.close();
    };
    child.stdin.on('error', () => {
      if (this.process === child) this.kill();
    });
    child.once('error', exit);
    child.once('exit', exit);
  }
  private send(value: object): void {
    this.process?.stdin.write(JSON.stringify(value) + '\n');
  }
  async probe(refresh = false): Promise<AiOsAiStatus> {
    if (refresh) this.cached = undefined;
    if (this.cached) return this.cached;
    const platform = this.platformId();
    if (!platform) return { available: false, platform: null, reason: 'unsupported-platform' };
    try {
      this.start();
      const reply = await new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.listeners.delete(listener);
          this.kill();
          reject(new AiFailure('timeout'));
        }, 10 * MS_PER_SECOND);
        const listener = (reply: Reply) => {
          if (reply.type !== 'probe' && reply.type !== 'error') return;
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(reply);
        };
        this.listeners.add(listener);
        this.send({ type: 'probe' });
      });
      this.cached = {
        available: reply.available === true,
        platform,
        modelLabel: reply.modelLabel,
        ...(reply.available ? {} : { reason: 'not-enabled' as const }),
      };
      this.scheduleIdle();
      return this.cached;
    } catch {
      // catch-no-log-ok unavailable helpers are an expected platform condition
      return {
        available: false,
        platform,
        reason: 'probe-failed',
      };
    }
  }
  async generate(
    input: { requestId: string; system: string; user: string; maxTokens: number },
    signal: AbortSignal,
    onDelta: (delta: string) => void,
  ): Promise<void> {
    this.start();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        this.listeners.delete(listener);
        this.scheduleIdle();
        if (error) reject(error);
        else resolve();
      };
      const cancel = () => {
        this.send({ type: 'cancel', requestId: input.requestId });
        finish(new AiFailure('cancelled'));
        this.kill();
      };
      const listener = (reply: Reply) => {
        if (reply.requestId && reply.requestId !== input.requestId) return;
        if (reply.type === 'delta' && typeof reply.text === 'string') {
          try {
            onDelta(reply.text);
          } catch (error) {
            // catch-no-log-ok fail the request without native output
            finish(error instanceof AiFailure ? error : new AiFailure('error'));
            this.kill();
            return;
          }
        }
        if (reply.type === 'done') finish();
        if (reply.type === 'error') finish(new AiFailure('error'));
      };
      const timer = setTimeout(() => {
        finish(new AiFailure('timeout'));
        this.kill();
      }, AI_REQUEST_TIMEOUT_MS);
      this.listeners.add(listener);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      this.send({ type: 'generate', ...input });
    });
  }
  private scheduleIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.kill();
    }, 30 * MS_PER_SECOND);
    this.idle.unref();
  }
  kill(): void {
    clearTimeout(this.idle);
    const child = this.process;
    this.process = null;
    this.reader?.close();
    this.reader = null;
    child?.kill();
    for (const listener of [...this.listeners]) listener({ type: 'error' });
  }
}
