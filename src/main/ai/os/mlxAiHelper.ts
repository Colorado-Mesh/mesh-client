import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { AI_MAX_RESPONSE_BYTES, AI_REQUEST_TIMEOUT_MS } from '../../../shared/ai-types';
import { MS_PER_SECOND } from '../../../shared/timeConstants';
import { AiFailure } from '../errors';
import { isAppleSiliconMac } from '../local/modelManifest';
import { isMlxHelperInstallComplete } from './ensureMlxHelper';

interface Reply {
  type: string;
  requestId?: string;
  text?: string;
  available?: boolean;
  modelLabel?: string;
  reason?: string;
}

/**
 * Spawns the arm64 mesh-ai-mlx helper for Metal Catch up.
 * Same JSON-lines protocol as OsAiHelper, plus modelPath on generate.
 */
export class MlxAiHelper {
  private process: ChildProcessWithoutNullStreams | null = null;
  private reader: ReturnType<typeof createInterface> | null = null;
  private listeners = new Set<(reply: Reply) => void>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private probed = false;

  constructor(
    private readonly binary: () => string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly arch: NodeJS.Architecture = process.arch,
  ) {}

  availableOnHost(): boolean {
    return isAppleSiliconMac(this.platform, this.arch) && isMlxHelperInstallComplete(this.binary());
  }

  private start(): void {
    clearTimeout(this.idle);
    if (this.process) return;
    if (!this.availableOnHost()) throw new AiFailure('engineNotReady');
    const binary = this.binary();
    // cwd = binary dir so adjacent SwiftPM bundles (default.metallib) resolve.
    const child = spawn(binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.dirname(binary),
    });
    this.process = child;
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.warn('[mesh-ai-mlx]', text.slice(0, 500));
    });
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
        // catch-no-log-ok mlx-swift may print non-JSON diagnostics on stdout
        console.warn('[mesh-ai-mlx] non-JSON stdout', line.slice(0, 300));
      }
    });
    const exit = () => {
      if (this.process === child) {
        this.process = null;
        this.probed = false;
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

  async probe(refresh = false): Promise<boolean> {
    if (!this.availableOnHost()) return false;
    if (this.probed && !refresh) return true;
    try {
      this.start();
      const reply = await new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.listeners.delete(listener);
          this.kill();
          reject(new AiFailure('timeout'));
        }, 10 * MS_PER_SECOND);
        const listener = (value: Reply) => {
          if (value.type !== 'probe' && value.type !== 'error' && value.type !== 'ready') return;
          if (value.type === 'ready') return;
          clearTimeout(timer);
          this.listeners.delete(listener);
          if (value.type === 'error') reject(new AiFailure('error'));
          else resolve(value);
        };
        this.listeners.add(listener);
        this.send({ type: 'probe' });
      });
      this.probed = reply.available === true;
      this.scheduleIdle();
      return this.probed;
    } catch {
      // catch-no-log-ok missing/broken helpers leave MLX unavailable
      if (this.process) this.scheduleIdle();
      this.probed = false;
      return false;
    }
  }

  async generate(
    input: {
      requestId: string;
      system: string;
      user: string;
      maxTokens: number;
      modelPath: string;
    },
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    timeoutMs = AI_REQUEST_TIMEOUT_MS,
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
      }, timeoutMs);
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
    this.probed = false;
    this.reader?.close();
    this.reader = null;
    child?.kill();
    for (const listener of [...this.listeners]) listener({ type: 'error' });
  }
}
