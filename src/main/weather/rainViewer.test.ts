import { describe, expect, it } from 'vitest';

import { parseRainViewerManifest } from './rainViewer';

describe('rainViewer', () => {
  it('parses past + nowcast and sorts', () => {
    const manifest = parseRainViewerManifest({
      version: '2.0',
      generated: 1_700_000_000,
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [
          { time: 1_700_000_100, path: '/v2/radar/bbb' },
          { time: 1_700_000_000, path: '/v2/radar/aaa' },
        ],
        nowcast: [{ time: 1_700_000_200, path: '/v2/radar/ccc' }],
      },
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.frames.map((f) => f.timeMs)).toEqual([
      1_700_000_000_000, 1_700_000_100_000, 1_700_000_200_000,
    ]);
    expect(manifest!.frames[2]?.kind).toBe('nowcast');
  });

  it('rejects non-allowlisted host and malformed paths', () => {
    expect(
      parseRainViewerManifest({
        generated: 1,
        host: 'https://evil.example',
        radar: { past: [{ time: 1, path: '/v2/radar/aaa' }], nowcast: [] },
      }),
    ).toBeNull();
    const m = parseRainViewerManifest({
      generated: 1,
      host: 'https://tilecache.rainviewer.com',
      radar: {
        past: [{ time: 1, path: '/v2/radar/../../../etc' }],
        nowcast: [],
      },
    });
    expect(m!.frames).toHaveLength(0);
  });

  it('handles empty nowcast', () => {
    const m = parseRainViewerManifest({
      generated: 1,
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: 10, path: '/v2/radar/ok' }], nowcast: [] },
    });
    expect(m!.frames).toHaveLength(1);
  });
});
