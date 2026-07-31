// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { DEDUPE_DIST_ARGS, DEDUPE_DIST_MAX_ATTEMPTS, runDedupeDist } from './dedupe-dist.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('dedupe-dist.mjs', () => {
  it('skips install scripts during dist dedupe', () => {
    expect(DEDUPE_DIST_ARGS).toEqual(['dedupe', '--config.ignore-scripts=true']);
    expect(DEDUPE_DIST_MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });

  it('wires package.json dedupe:dist to the retry helper', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
    expect(packageJson.scripts?.['dedupe:dist']).toBe('node scripts/dedupe-dist.mjs');
  });

  it('retries after cleaning @jsr temp dirs when pnpm dedupe fails', () => {
    const cleaned = [];
    const spawnPnpm = vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 0 });
    const status = runDedupeDist({
      cwd: '/tmp/mesh-dedupe-fixture',
      spawnPnpm,
      cleanTemps: (root) => cleaned.push(root),
    });
    expect(status).toBe(0);
    expect(spawnPnpm).toHaveBeenCalledTimes(2);
    expect(cleaned).toEqual([path.join('/tmp/mesh-dedupe-fixture', 'node_modules')]);
    expect(spawnPnpm.mock.calls[0]?.[1]).toEqual(DEDUPE_DIST_ARGS);
  });

  it('returns last failure status after exhausting retries', () => {
    const spawnPnpm = vi.fn().mockReturnValue({ status: 1 });
    const status = runDedupeDist({
      cwd: '/tmp/mesh-dedupe-fixture',
      maxAttempts: 3,
      spawnPnpm,
      cleanTemps: () => {},
    });
    expect(status).toBe(1);
    expect(spawnPnpm).toHaveBeenCalledTimes(3);
  });
});
