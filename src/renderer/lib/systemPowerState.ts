/** Module-level macOS sleep / resume flag shared by runtimes (not React state). */
let systemSuspended = false;
const resumeWaiters = new Set<() => void>();

export function getSystemSuspended(): boolean {
  return systemSuspended;
}

export function setSystemSuspended(suspended: boolean): void {
  if (systemSuspended === suspended) return;
  systemSuspended = suspended;
  if (!suspended) {
    for (const resolve of resumeWaiters) {
      resolve();
    }
    resumeWaiters.clear();
  }
}

export function waitForSystemResumed(): Promise<void> {
  if (!systemSuspended) return Promise.resolve();
  return new Promise((resolve) => {
    resumeWaiters.add(resolve);
  });
}

/** Sleep in slices; abort when suspended (resume handler restarts recovery) or predicate true. */
export async function delayUnlessSuspended(
  ms: number,
  shouldAbort: () => boolean,
  sliceMs = 500,
): Promise<'done' | 'aborted' | 'suspended'> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (shouldAbort()) return 'aborted';
    if (systemSuspended) return 'suspended';
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((r) => setTimeout(r, Math.min(sliceMs, remaining)));
  }
  if (shouldAbort()) return 'aborted';
  if (systemSuspended) return 'suspended';
  return 'done';
}
