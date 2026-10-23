import type { ProcessMetric } from 'electron';

type ProcessMemoryMetric = Pick<ProcessMetric, 'pid' | 'type'> & {
  memory: Pick<ProcessMetric['memory'], 'workingSetSize'>;
};

/** Electron reports workingSetSize in KiB; scope this to the requesting renderer process. */
export function rendererProcessMemoryBytes(
  metrics: readonly ProcessMemoryMetric[],
  rendererPid: number,
): number | undefined {
  if (!Number.isInteger(rendererPid) || rendererPid <= 0) return undefined;
  const metric = metrics.find((entry) => entry.pid === rendererPid && entry.type === 'Tab');
  if (!metric) return undefined;
  const bytes = metric.memory.workingSetSize * 1024;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}
