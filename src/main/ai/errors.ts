import type { AiSummaryErrorReason } from '../../shared/ai-types';

export class AiFailure extends Error {
  constructor(readonly reason: AiSummaryErrorReason) {
    super(reason);
  }
}
export function aiErrorReason(error: unknown, signal?: AbortSignal): AiSummaryErrorReason {
  if (signal?.aborted)
    return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled';
  if (error instanceof AiFailure) return error.reason;
  return 'error';
}
