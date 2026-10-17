import type { Wllama } from '@wllama/wllama/esm/index';

import type { AiLocalJob } from '@/shared/ai-types';
import { AI_MAX_OUTPUT_TOKENS } from '@/shared/ai-types';

import { hasRepetitiveAiOutput, RepetitiveAiOutputError } from './aiSummaryOutput';

export type AiWorkerPhase = 'loadingModel' | 'readingMessages';

export interface AiWorkerGenerateOptions {
  /** Keep the loaded model for another generate on this host (multi-pass). */
  keepAlive?: boolean;
}

// Wllama forwards these llama.cpp wire names unchanged; its v3 types use older names.
const sampling = { repeat_penalty: 1.1, repeat_last_n: 64 };

// Wllama owns the dedicated WASM worker. No runtime, worker or assets load at import time.
export class AiWorkerHost {
  private runtime: Wllama | null = null;
  private loadedModelUrl: string | null = null;
  private busy = false;
  async generate(
    job: AiLocalJob,
    signal: AbortSignal,
    onDelta: (value: string) => void,
    onPhase?: (phase: AiWorkerPhase) => void,
    options?: AiWorkerGenerateOptions,
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
    let completed = false;
    let cleanupFailure: { cause: unknown } | undefined;
    try {
      if (!this.runtime || this.loadedModelUrl !== job.modelUrl) {
        await this.dispose();
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
        this.loadedModelUrl = job.modelUrl;
        signal.throwIfAborted();
      }
      onPhase?.('readingMessages');
      let text = '';
      await raced(
        this.runtime.createChatCompletion({
          ...sampling,
          messages: [
            { role: 'system', content: job.system },
            { role: 'user', content: job.user },
          ],
          max_tokens: AI_MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          top_p: 0.9,
          stream: true,
          abortSignal: signal,
          onData: (chunk) => {
            signal.throwIfAborted();
            const delta = chunk.choices[0]?.delta.content;
            if (!delta) return;
            text += delta;
            if (hasRepetitiveAiOutput(text)) throw new RepetitiveAiOutputError();
            onDelta(delta);
          },
        }),
      );
      signal.throwIfAborted();
      if (hasRepetitiveAiOutput(text)) throw new RepetitiveAiOutputError();
      completed = true;
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        if (!options?.keepAlive || !completed) await this.dispose();
      } catch (error) {
        // catch-no-log-ok preserve an existing generation failure if teardown also fails
        if (completed) cleanupFailure = { cause: error };
      } finally {
        this.busy = false;
      }
    }
    if (cleanupFailure) throw cleanupFailure.cause;
  }
  async dispose(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.loadedModelUrl = null;
    if (runtime) await runtime.exit();
  }
}
