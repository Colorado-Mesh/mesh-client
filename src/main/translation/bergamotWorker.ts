import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { MS_PER_MINUTE, MS_PER_SECOND } from '../../shared/timeConstants';
import type { TranslationWorkerJob, TranslationWorkerReply } from './bergamotWorkerRuntime';

export interface TranslationWorkerPort {
  postMessage(job: TranslationWorkerJob): void;
  once(event: 'message', listener: (reply: TranslationWorkerReply) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  removeListener(event: 'message', listener: (reply: TranslationWorkerReply) => void): this;
  removeAllListeners(): this;
  terminate(): Promise<number>;
}

/** Host timers remain responsive while synchronous WASM inference runs in the worker. */
export class BergamotWorker {
  private worker?: TranslationWorkerPort;
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private generation = 0;
  private nextId = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private failActive?: () => void;
  private terminating: Promise<unknown> = Promise.resolve();

  private terminate(worker: TranslationWorkerPort): void {
    this.terminating = worker.terminate().catch(() => {
      console.warn('[translation] Could not terminate worker');
    });
  }

  constructor(
    private readonly options: {
      createWorker?: () => TranslationWorkerPort;
      timeoutMs?: number;
      idleMs?: number;
    } = {},
  ) {}

  run(job: Omit<TranslationWorkerJob, 'id'>): Promise<TranslationWorkerReply> {
    if (this.queued >= 20) return Promise.reject(new Error('Translation queue full'));
    this.queued += 1;
    const generation = this.generation;
    const result = this.tail.then(async () => {
      await this.terminating;
      if (generation !== this.generation) throw new Error('Translation cancelled');
      return this.execute({ ...job, id: ++this.nextId });
    });
    this.tail = result.catch(() => {
      // catch-no-log-ok caller receives the rejection; keep serial queue usable
    });
    return result.finally(() => {
      this.queued -= 1;
    });
  }

  dispose(): void {
    this.generation += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.failActive?.();
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      this.terminate(worker);
    }
  }

  private execute(job: TranslationWorkerJob): Promise<TranslationWorkerReply> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    let worker = this.worker;
    if (!worker) {
      worker =
        this.options.createWorker?.() ?? new Worker(path.join(__dirname, 'translation-worker.js'));
      this.worker = worker;
      const created = worker;
      const failed = () => {
        if (this.worker === created) {
          if (this.failActive) this.failActive();
          else {
            this.worker = undefined;
            this.terminate(created);
          }
        }
      };
      worker.on('error', failed);
      worker.on('exit', failed);
    }
    const active = worker;
    return new Promise((resolve, reject) => {
      const finish = (reply?: TranslationWorkerReply) => {
        clearTimeout(timer);
        active.removeListener('message', onMessage);
        this.failActive = undefined;
        if (reply && !reply.error) {
          this.idleTimer = setTimeout(() => {
            this.dispose();
          }, this.options.idleMs ?? MS_PER_MINUTE);
          this.idleTimer.unref?.();
          resolve(reply);
        } else {
          this.worker = undefined;
          this.terminate(active);
          reject(new Error('Translation worker failed'));
        }
      };
      const timer = setTimeout(
        () => {
          finish();
        },
        this.options.timeoutMs ?? 30 * MS_PER_SECOND,
      );
      this.failActive = () => {
        finish();
      };
      const onMessage = (reply: TranslationWorkerReply) => {
        if (reply.id === job.id) finish(reply);
        else finish();
      };
      active.once('message', onMessage);
      try {
        active.postMessage(job);
      } catch {
        // catch-no-log-ok failed transport is returned through the request rejection
        finish();
      }
    });
  }
}
