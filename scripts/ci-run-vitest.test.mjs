// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildCiVitestArgs, parseRelatedPaths, runCiVitest } from './ci-run-vitest.mjs';

describe('ci-run-vitest', () => {
  it('builds a coverage shard for a full run', () => {
    expect(buildCiVitestArgs({ mode: 'full', project: 'main' })).toEqual([
      'run',
      '--coverage',
      '--coverage.clean=false',
      '--project',
      'main',
      '--reporter=blob',
      '--outputFile.blob=.vitest-reports/blob-main.json',
      '--passWithNoTests',
    ]);
  });

  it('passes related paths as literal argv entries', () => {
    const relatedPath = 'src/main/a file & more.ts';
    const runVitestArgvFn = vi.fn(() => 0);
    expect(
      runCiVitest(
        { mode: 'related', project: 'main', relatedPaths: [relatedPath] },
        { cwd: '/repo', runVitestArgvFn },
      ),
    ).toBe(0);
    expect(runVitestArgvFn).toHaveBeenCalledWith(
      [
        'related',
        '--run',
        '--project',
        'main',
        '--reporter=blob',
        '--outputFile.blob=.vitest-reports/blob-main.json',
        '--passWithNoTests',
        relatedPath,
      ],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('validates related-path JSON', () => {
    expect(parseRelatedPaths('["src/main/database.ts"]')).toEqual(['src/main/database.ts']);
    expect(() => parseRelatedPaths('{"path":"src/main/database.ts"}')).toThrow(
      'VITEST_PATHS_JSON must be a JSON array of strings',
    );
    expect(() => parseRelatedPaths('[1]')).toThrow(
      'VITEST_PATHS_JSON must be a JSON array of strings',
    );
  });

  it('rejects unknown projects and empty related selections', () => {
    expect(() => buildCiVitestArgs({ mode: 'full', project: 'unknown' })).toThrow(
      'Unknown Vitest project',
    );
    expect(() => buildCiVitestArgs({ mode: 'related', project: 'main', relatedPaths: [] })).toThrow(
      'Invalid Vitest CI selection',
    );
  });
});
