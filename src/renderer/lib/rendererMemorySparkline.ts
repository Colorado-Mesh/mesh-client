import { RENDERER_MEMORY_CHART_GAP_MS } from './timeConstants';

export interface RendererMemorySparklineSample {
  at: number;
  bytes: number;
}

/**
 * Time-proportional polyline point strings for an SVG sparkline.
 * Breaks into multiple segments when consecutive samples exceed `gapMs`.
 */
export function buildRendererMemorySparklineSegments(
  samples: readonly RendererMemorySparklineSample[],
  options?: { width?: number; height?: number; padY?: number; gapMs?: number },
): string[] {
  if (samples.length < 2) return [];
  const width = options?.width ?? 300;
  const height = options?.height ?? 50;
  const padY = options?.padY ?? 4;
  const gapMs = options?.gapMs ?? RENDERER_MEMORY_CHART_GAP_MS;
  const usableY = height - padY * 2;
  const historyMax = Math.max(1, ...samples.map((sample) => sample.bytes));
  const t0 = samples[0].at;
  const t1 = samples[samples.length - 1].at;
  const span = Math.max(1, t1 - t0);
  const xOf = (at: number) => ((at - t0) / span) * width;
  const yOf = (bytes: number) => height - padY - (bytes / historyMax) * usableY;

  const segments: string[] = [];
  let current: string[] = [];
  let prevAt: number | undefined;
  for (const sample of samples) {
    if (prevAt !== undefined && sample.at - prevAt > gapMs) {
      if (current.length >= 2) segments.push(current.join(' '));
      current = [];
    }
    current.push(`${xOf(sample.at)},${yOf(sample.bytes)}`);
    prevAt = sample.at;
  }
  if (current.length >= 2) segments.push(current.join(' '));
  return segments;
}
