import { describe, expect, it } from 'vitest';

import { buildRendererMemorySparklineSegments } from './rendererMemorySparkline';
import { MS_PER_HOUR } from './timeConstants';

describe('buildRendererMemorySparklineSegments', () => {
  it('returns no segments for fewer than two samples', () => {
    expect(buildRendererMemorySparklineSegments([])).toEqual([]);
    expect(buildRendererMemorySparklineSegments([{ at: 1, bytes: 10 }])).toEqual([]);
  });

  it('maps X by time and Y by bytes', () => {
    const segments = buildRendererMemorySparklineSegments(
      [
        { at: 0, bytes: 0 },
        { at: 100, bytes: 100 },
      ],
      { width: 300, height: 50, padY: 4, gapMs: 1_000 },
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toBe('0,46 300,4');
  });

  it('breaks the polyline across large time gaps', () => {
    const gapMs = 4 * MS_PER_HOUR;
    const segments = buildRendererMemorySparklineSegments(
      [
        { at: 0, bytes: 100 },
        { at: MS_PER_HOUR, bytes: 120 },
        { at: 10 * MS_PER_HOUR, bytes: 200 },
        { at: 11 * MS_PER_HOUR, bytes: 220 },
      ],
      { gapMs, width: 300, height: 50, padY: 4 },
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]?.split(' ')).toHaveLength(2);
    expect(segments[1]?.split(' ')).toHaveLength(2);
  });
});
