import { describe, expect, it } from 'vitest';

import { iemFrames, radarBucketMs } from './iemRadar';

describe('iemRadar', () => {
  it('synthesizes 12 frames at 5-minute lags', () => {
    const now = Date.parse('2026-11-08T12:07:00Z');
    const frames = iemFrames(now);
    expect(frames.frames).toHaveLength(12);
    expect(frames.provider).toBe('iem-nexrad');
    expect(frames.maxNativeZoom).toBe(10);
    expect(frames.frames[0]?.id).toBe('0');
    expect(frames.frames[1]?.id).toBe('5');
    const bucket = radarBucketMs(now);
    expect(frames.frames[0]?.tileUrlTemplate).toContain(`t=${bucket}`);
  });

  it('bucket math snaps to 5 minutes', () => {
    const now = Date.parse('2026-11-08T12:04:59Z');
    expect(radarBucketMs(now)).toBe(Date.parse('2026-11-08T12:00:00Z'));
  });
});
