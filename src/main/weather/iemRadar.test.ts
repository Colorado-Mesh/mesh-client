import { describe, expect, it } from 'vitest';

import { iemFrames, radarBucketMs } from './iemRadar';

describe('iemRadar', () => {
  it('synthesizes 12 frames at 5-minute lags', () => {
    const now = Date.parse('2026-11-08T12:07:00Z');
    const frames = iemFrames(now);
    expect(frames.frames).toHaveLength(12);
    expect(frames.provider).toBe('iem-nexrad');
    expect(frames.maxNativeZoom).toBe(10);
    const oldest = frames.frames[0];
    const newest = frames.frames[frames.frames.length - 1];
    expect(oldest?.id).toBe('55');
    expect(frames.frames[1]?.id).toBe('50');
    expect(newest?.id).toBe('0');
    expect(oldest?.timeMs).toBeLessThan(newest?.timeMs ?? Number.POSITIVE_INFINITY);
    const bucket = radarBucketMs(now);
    expect(newest?.tileUrlTemplate).toContain(`t=${bucket}`);
  });

  it('bucket math snaps to 5 minutes', () => {
    const now = Date.parse('2026-11-08T12:04:59Z');
    expect(radarBucketMs(now)).toBe(Date.parse('2026-11-08T12:00:00Z'));
  });
});
