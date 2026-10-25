/**
 * Origins allowed to postMessage dedicated analysis workers.
 * Prefer Array.includes — CodeQL js/missing-origin-check recognizes InclusionTest.
 */
export const ANALYSIS_WORKER_ALLOWED_ORIGINS = [
  'mesh-client://renderer',
  'null',
  'file://',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
] as const;

export function isAllowedWorkerMessageOrigin(
  eventOrigin: string,
  workerOrigin: string,
  allowed: readonly string[] = ANALYSIS_WORKER_ALLOWED_ORIGINS,
): boolean {
  if (allowed.includes(eventOrigin)) return true;
  // Dedicated Worker.postMessage leaves MessageEvent.origin empty in Chromium.
  return eventOrigin === '' && allowed.includes(workerOrigin);
}
