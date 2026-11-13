import { mkdtempSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MAP_OVERLAY_MAX_BYTES } from '@/shared/mapOverlays/types';

import { importMapOverlayFromPath } from './importOverlay';

describe('importMapOverlayFromPath', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  function tempDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-overlay-import-'));
    dirs.push(dir);
    return dir;
  }

  it('imports GeoJSON via a single open/fstat/read handle', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'sample.geojson');
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [-105.0, 39.7] },
          },
        ],
      }),
      'utf8',
    );
    const result = await importMapOverlayFromPath(file);
    expect(result).toMatchObject({ ok: true, format: 'geojson', name: 'sample' });
    if (result.ok) {
      expect(result.geojson.features).toHaveLength(1);
    }
  });

  it('rejects oversized files before reading payload into parse', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'huge.geojson');
    // Sparse-ish write: create a file larger than the cap without holding it all in JS twice.
    const fh = await fs.open(file, 'w');
    try {
      await fh.truncate(MAP_OVERLAY_MAX_BYTES + 1);
    } finally {
      await fh.close();
    }
    await expect(importMapOverlayFromPath(file)).resolves.toEqual({ ok: false, code: 'too_large' });
  });

  it('returns unsupported for unknown extensions', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'notes.txt');
    await fs.writeFile(file, 'hello', 'utf8');
    await expect(importMapOverlayFromPath(file)).resolves.toEqual({
      ok: false,
      code: 'unsupported',
    });
  });
});
