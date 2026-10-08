import { parentPort } from 'node:worker_threads';

import { BergamotWorkerRuntime, type TranslationWorkerJob } from './bergamotWorkerRuntime';

const runtime = new BergamotWorkerRuntime();
let tail: Promise<void> = Promise.resolve();
parentPort?.on('message', (job: TranslationWorkerJob) => {
  tail = tail.then(async () => {
    try {
      parentPort?.postMessage(await runtime.run(job));
    } catch {
      // catch-no-log-ok never include message text or native diagnostics in renderer errors
      runtime.dispose();
      parentPort?.postMessage({ id: job.id, error: true });
    }
  });
});
