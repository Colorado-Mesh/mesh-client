/// <reference lib="webworker" />

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { runAnalysisJob } from '../lib/workers/analysisJobHandlers';
import type {
  AnalysisWorkerInbound,
  AnalysisWorkerOutbound,
} from '../lib/workers/analysisJobTypes';
import { isAllowedWorkerMessageOrigin } from '../lib/workers/workerOrigins';

self.onmessage = (event: MessageEvent<AnalysisWorkerInbound>) => {
  if (!isAllowedWorkerMessageOrigin(event.origin, self.location.origin)) {
    return;
  }
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('kind' in data) || !('sequence' in data)) {
    return;
  }
  const request = data as AnalysisWorkerInbound;
  try {
    const result: AnalysisWorkerOutbound = runAnalysisJob(request);
    self.postMessage(result);
  } catch (err) {
    console.warn('[analysis.worker] job failed ' + errLikeToLogString(err));
    const reply: AnalysisWorkerOutbound = {
      kind: 'error',
      sequence: request.sequence,
      requestKind: request.kind,
      error: String(err),
    };
    self.postMessage(reply);
  }
};
