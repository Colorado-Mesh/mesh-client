import { parentPort } from 'node:worker_threads';

import { sanitizeLogMessage } from '../sanitize-log-message';
import { BergamotWorkerRuntime, type TranslationWorkerJob } from './bergamotWorkerRuntime';

const runtime = new BergamotWorkerRuntime();
let tail: Promise<void> = Promise.resolve();
parentPort?.on('message', (job: TranslationWorkerJob) => {
  tail = tail.then(async () => {
    try {
      parentPort?.postMessage(await runtime.run(job));
    } catch (e: unknown) {
      console.debug(
        '[main/translation/bergamotWorkerEntry] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );

      runtime.dispose();
      parentPort?.postMessage({ id: job.id, error: true });
    }
  });
});
