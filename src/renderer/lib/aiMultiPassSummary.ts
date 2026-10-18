import type {
  AiActionResult,
  AiEngine,
  AiLocalJob,
  AiProviderStatus,
  AiSummaryMessage,
  AiSummaryPassMode,
  AiSummaryRequest,
} from '@/shared/ai-types';
import { AI_MAX_RESPONSE_BYTES, aiSummaryTimeoutMs } from '@/shared/ai-types';
import {
  type AiSummaryPromptContext,
  packAiDigestChunks,
  packAiSummaryChunks,
} from '@/shared/aiSummaryChunking';

import { RepetitiveAiOutputError } from './aiSummaryOutput';
import { AiWorkerHost } from './aiWorkerHost';

export interface MultiPassProgress {
  kind: 'chunk' | 'merge';
  current: number;
  total: number;
}

export interface MultiPassCallbacks {
  onProgress: (progress: MultiPassProgress | null) => void;
  onPhase: (phase: 'loadingModel' | 'readingMessages' | undefined) => void;
  onFinalDelta: (delta: string) => void;
  onFinalText: (text: string) => void;
  /** Map/reduce: accumulate without updating the Catch up card text. */
  waitForSilentRemoteDone: (requestId: string) => Promise<{ text: string; messageCount: number }>;
  /** Final pass: stream chunks onto the card, then resolve when done. */
  waitForStreamingRemoteDone: (
    requestId: string,
  ) => Promise<{ text: string; messageCount: number }>;
  /** Drop a waiter when main returns a bundled localJob instead of streaming. */
  cancelRemoteWaiter: (requestId: string) => void;
}

export function shouldUseMultiPass(
  messages: AiSummaryMessage[],
  engine: AiEngine,
  context: Partial<AiSummaryPromptContext> = {},
): boolean {
  return packAiSummaryChunks(messages, engine, { ...context, mode: 'final' }).length > 1;
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Cancelled', 'AbortError'),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
    if (signal.aborted) abort();
  });
}

async function runLocalJob(
  job: AiLocalJob,
  signal: AbortSignal,
  host: AiWorkerHost,
  stream: boolean,
  callbacks: MultiPassCallbacks,
  keepAlive: boolean,
): Promise<string> {
  let text = '';
  await host.generate(
    job,
    signal,
    (delta) => {
      text += delta;
      if (text.length > AI_MAX_RESPONSE_BYTES) throw new Error('tooLarge');
      if (stream) callbacks.onFinalDelta(delta);
    },
    (phase) => {
      callbacks.onPhase(phase);
    },
    { keepAlive },
  );
  return text;
}

async function executePass(
  request: AiSummaryRequest,
  signal: AbortSignal,
  host: AiWorkerHost | null,
  stream: boolean,
  callbacks: MultiPassCallbacks,
  keepAlive: boolean,
  timeoutMs: number,
): Promise<{ text: string; messageCount: number; truncated: boolean; host: AiWorkerHost | null }> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  signal.throwIfAborted();
  // Register before summarize so remote done/chunk events cannot race the waiter.
  const remoteDone = stream
    ? callbacks.waitForStreamingRemoteDone(request.requestId)
    : callbacks.waitForSilentRemoteDone(request.requestId);
  void remoteDone.catch(() => {
    /* catch-no-log-ok waiter may reject while acknowledgement is pending */
  });
  try {
    const result: AiActionResult = await raceAbort(
      window.electronAPI.ai.summarize(request),
      signal,
    );
    signal.throwIfAborted();
    if (!result.ok) throw new Error(result.reason ?? 'error');
    const messageCount = result.summaryInput?.messageCount ?? result.localJob?.messageCount;
    const truncated = result.summaryInput?.truncated ?? result.localJob?.truncated ?? false;
    if (truncated || (messageCount !== undefined && messageCount !== request.messages.length))
      throw new Error('tooLarge');
    if (result.localJob) {
      callbacks.cancelRemoteWaiter(request.requestId);
      const nextHost = host ?? new AiWorkerHost();
      try {
        const text = await runLocalJob(
          result.localJob,
          signal,
          nextHost,
          stream,
          callbacks,
          keepAlive,
        );
        if (!text.trim()) throw new Error('invalidResponse');
        if (stream) callbacks.onFinalText(text);
        return {
          text,
          messageCount: request.messages.length,
          truncated: false,
          host: keepAlive ? nextHost : null,
        };
      } catch (error) {
        await nextHost.dispose();
        throw error;
      }
    }
    const done = await raceAbort(remoteDone, signal);
    if (done.messageCount !== request.messages.length) throw new Error('tooLarge');
    if (!done.text.trim()) throw new Error('invalidResponse');
    if (stream) callbacks.onFinalText(done.text);
    return { text: done.text, messageCount: done.messageCount, truncated: false, host };
  } finally {
    callbacks.cancelRemoteWaiter(request.requestId);
    if (signal.aborted) {
      void window.electronAPI.ai.cancel(request.requestId).catch(() => {
        /* catch-no-log-ok cancelled pass never exposes provider details */
      });
    }
  }
}

function digestMessages(digests: string[]): AiSummaryMessage[] {
  return digests.map((body, index) => ({
    at: index + 1,
    sender: `Part ${index + 1}`,
    body,
  }));
}

/**
 * Run map → reduce → final for a Catch up that does not fit one prompt.
 * Caller owns the FIFO queue slot and AbortSignal for the whole job.
 */
export async function runMultiPassSummary(input: {
  base: Omit<AiSummaryRequest, 'requestId' | 'mode' | 'messages' | 'jobId'>;
  messages: AiSummaryMessage[];
  status: AiProviderStatus;
  signal: AbortSignal;
  callbacks: MultiPassCallbacks;
}): Promise<{ messageCount: number; truncated: boolean }> {
  const engine = input.status.engine;
  if (!engine) throw new Error('notConfigured');
  const jobId = crypto.randomUUID();
  const chunks = packAiSummaryChunks(input.messages, engine, { ...input.base, mode: 'map' });
  if (!chunks.length) throw new Error('noMessages');
  let host: AiWorkerHost | null = null;
  const timeoutMs = aiSummaryTimeoutMs(engine, input.status.timeoutSeconds);
  let anyTruncated = false;
  const digests: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      input.signal.throwIfAborted();
      input.callbacks.onProgress({ kind: 'chunk', current: i + 1, total: chunks.length });
      const pass = await executePass(
        {
          ...input.base,
          requestId: crypto.randomUUID(),
          jobId,
          mode: 'map',
          messages: chunks[i],
        },
        input.signal,
        host,
        false,
        input.callbacks,
        true,
        timeoutMs,
      );
      host = pass.host;
      digests.push(pass.text);
      anyTruncated = anyTruncated || pass.truncated;
    }

    let level = digests;
    let rounds = 0;
    while (true) {
      if (
        packAiSummaryChunks(digestMessages(level), engine, {
          ...input.base,
          mode: 'final',
          digests: true,
        }).length <= 1
      )
        break;
      if (++rounds > 8) throw new Error('invalidResponse');
      const batches = packAiDigestChunks(level, engine, input.base);
      input.callbacks.onProgress({ kind: 'merge', current: 1, total: batches.length });
      const next: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        input.signal.throwIfAborted();
        input.callbacks.onProgress({ kind: 'merge', current: i + 1, total: batches.length });
        const pass = await executePass(
          {
            ...input.base,
            requestId: crypto.randomUUID(),
            jobId,
            mode: 'reduce',
            messages: batches[i],
          },
          input.signal,
          host,
          false,
          input.callbacks,
          true,
          timeoutMs,
        );
        host = pass.host;
        next.push(pass.text);
        anyTruncated = anyTruncated || pass.truncated;
      }
      const bytes = (values: string[]) =>
        values.reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0);
      if (next.length >= level.length && bytes(next) >= bytes(level))
        throw new Error('invalidResponse');
      level = next;
    }

    input.callbacks.onProgress(null);
    input.callbacks.onPhase(undefined);
    const finalMessages = digestMessages(level);
    const final = await executePass(
      {
        ...input.base,
        requestId: crypto.randomUUID(),
        jobId,
        mode: 'final',
        messages: finalMessages,
      },
      input.signal,
      host,
      true,
      input.callbacks,
      false,
      timeoutMs,
    );
    host = null;
    anyTruncated = anyTruncated || final.truncated;
    return { messageCount: input.messages.length, truncated: anyTruncated };
  } catch (error) {
    await host?.dispose().catch(() => {
      /* catch-no-log-ok */
    });
    if (error instanceof RepetitiveAiOutputError) throw error;
    throw error;
  }
}

export type { AiSummaryPassMode };
