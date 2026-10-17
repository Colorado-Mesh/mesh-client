import type {
  AiActionResult,
  AiEngine,
  AiLocalJob,
  AiProviderStatus,
  AiSummaryMessage,
  AiSummaryPassMode,
  AiSummaryRequest,
} from '@/shared/ai-types';
import { AI_MAX_RESPONSE_BYTES } from '@/shared/ai-types';
import { packAiDigestChunks, packAiSummaryChunks } from '@/shared/aiSummaryChunking';

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

export function shouldUseMultiPass(messages: AiSummaryMessage[], engine: AiEngine): boolean {
  return packAiSummaryChunks(messages, engine).length > 1;
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
): Promise<{ text: string; messageCount: number; truncated: boolean; host: AiWorkerHost | null }> {
  signal.throwIfAborted();
  // Register before summarize so remote done/chunk events cannot race the waiter.
  const remoteDone = stream
    ? callbacks.waitForStreamingRemoteDone(request.requestId)
    : callbacks.waitForSilentRemoteDone(request.requestId);
  const result: AiActionResult = await window.electronAPI.ai.summarize(request);
  if (!result.ok) {
    callbacks.cancelRemoteWaiter(request.requestId);
    void remoteDone.catch(() => {
      /* catch-no-log-ok abandoned waiter */
    });
    throw new Error(result.reason ?? 'error');
  }
  const messageCount = result.summaryInput?.messageCount ?? request.messages.length;
  const truncated = result.summaryInput?.truncated ?? false;
  if (result.localJob) {
    callbacks.cancelRemoteWaiter(request.requestId);
    void remoteDone.catch(() => {
      /* catch-no-log-ok bundled path */
    });
    const nextHost = host ?? new AiWorkerHost();
    const text = await runLocalJob(result.localJob, signal, nextHost, stream, callbacks, keepAlive);
    if (!text.trim()) throw new Error('invalidResponse');
    if (stream) callbacks.onFinalText(text);
    return { text, messageCount, truncated, host: keepAlive ? nextHost : null };
  }
  const done = await remoteDone;
  if (!done.text.trim()) throw new Error('invalidResponse');
  if (stream) callbacks.onFinalText(done.text);
  return { text: done.text, messageCount, truncated, host };
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
  const chunks = packAiSummaryChunks(input.messages, engine);
  if (!chunks.length) throw new Error('noMessages');
  let host: AiWorkerHost | null = null;
  let included = 0;
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
      );
      host = pass.host;
      digests.push(pass.text);
      included += chunks[i].length;
      anyTruncated = anyTruncated || pass.truncated;
    }

    let level = digests;
    while (true) {
      const batches = packAiDigestChunks(level, engine);
      if (batches.length <= 1) break;
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
        );
        host = pass.host;
        next.push(pass.text);
        anyTruncated = anyTruncated || pass.truncated;
      }
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
    );
    host = null;
    anyTruncated = anyTruncated || final.truncated;
    return { messageCount: included, truncated: anyTruncated };
  } catch (error) {
    await host?.dispose().catch(() => {
      /* catch-no-log-ok */
    });
    if (error instanceof RepetitiveAiOutputError) throw error;
    throw error;
  }
}

export type { AiSummaryPassMode };
