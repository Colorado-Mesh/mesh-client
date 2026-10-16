import type { Wllama } from '@wllama/wllama/esm/index';

import type { AiLocalJob } from '@/shared/ai-types';
import { AI_MAX_OUTPUT_TOKENS } from '@/shared/ai-types';

export type AiWorkerPhase = 'loadingModel' | 'readingMessages';

// Wllama owns the dedicated WASM worker. No runtime, worker or assets load at import time.
export class AiWorkerHost {
  private runtime: Wllama | null = null;
  private busy = false;
  async generate(
    job: AiLocalJob,
    signal: AbortSignal,
    onDelta: (value: string) => void,
    onPhase?: (phase: AiWorkerPhase) => void,
  ): Promise<void> {
    if (this.busy) throw new Error('busy');
    this.busy = true;
    const abort = () => {
      void this.dispose().catch(() => {
        /* catch-no-log-ok teardown errors do not expose model data */
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    let failRuntime!: () => void;
    const fatal = new Promise<never>((_resolve, reject) => {
      failRuntime = () => {
        reject(new Error('engineNotReady'));
      };
    });
    // A worker can fail before the first runtime operation attaches its race.
    void fatal.catch(() => {
      /* catch-no-log-ok the operation race reports a fixed runtime error */
    });
    const raced = <T>(work: Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const cancel = () => {
          reject(new DOMException('AI generation cancelled', 'AbortError'));
        };
        signal.addEventListener('abort', cancel, { once: true });
        Promise.race([work, fatal])
          .then(resolve, reject)
          .finally(() => {
            signal.removeEventListener('abort', cancel);
          });
        if (signal.aborted) cancel();
      });
    try {
      const [{ Wllama }, { default: wasmUrl }] = await raced(
        Promise.all([
          import('@wllama/wllama/esm/index'),
          import('@wllama/wllama/esm/wasm/wllama.wasm?url'), // source-policy-ok translation-no-bundled-models inert runtime, not model weights
        ]),
      );
      signal.throwIfAborted();
      const quiet = () => {};
      const runtime = new Wllama(
        { default: wasmUrl },
        {
          suppressNativeLog: true,
          logger: { debug: quiet, log: quiet, warn: quiet, error: failRuntime },
        },
      );
      runtime.setCompat(null);
      this.runtime = runtime;
      onPhase?.('loadingModel');
      const response = await raced(fetch(job.modelUrl, { signal }));
      if (!response.ok) throw new Error('engineNotReady');
      const blob = await raced(response.blob());
      signal.throwIfAborted();
      await raced(
        runtime.loadModel([blob], {
          n_ctx: 4096,
          n_threads: 1,
          n_gpu_layers: 0,
          n_parallel: 1,
          n_batch: 128,
          n_ubatch: 128,
        }),
      );
      signal.throwIfAborted();
      onPhase?.('readingMessages');
      const stream = await raced(
        runtime.createChatCompletion({
          messages: [
            { role: 'system', content: job.system },
            { role: 'user', content: job.user },
          ],
          max_tokens: AI_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          top_p: 0.9,
          stream: true,
          abortSignal: signal,
        }),
      );
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await raced(iterator.next());
        signal.throwIfAborted();
        if (next.done) break;
        const delta = next.value.choices[0]?.delta.content;
        if (delta) onDelta(delta);
      }
    } finally {
      signal.removeEventListener('abort', abort);
      await this.dispose();
      this.busy = false;
    }
  }
  async dispose(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime) await runtime.exit();
  }
}
