// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildCiVitestArgs,
  normalizeRelatedPathForVitest,
  parseRelatedPaths,
  runCiVitest,
} from './ci-run-vitest.mjs';

describe('ci-run-vitest', () => {
  it('builds a coverage shard for a full run', () => {
    expect(buildCiVitestArgs({ mode: 'full', project: 'main' })).toEqual([
      'run',
      '--coverage',
      '--coverage.clean=false',
      '--project',
      'main',
      '--passWithNoTests',
      '--reporter=blob',
      '--outputFile.blob=.vitest-reports/blob-main.json',
    ]);
  });

  it.each(['full', 'related'])('shards %s runs without colliding reports', (mode) => {
    const reporter = mode === 'full' ? 'blob' : 'junit';
    const shards = [
      ['renderer-ui', '1/3'],
      ['renderer-ui', '2/3'],
      ['renderer-ui', '3/3'],
      ['renderer-logic', '1/1'],
      ['main', '1/1'],
    ];
    const outputs = shards.map(([project, shard]) => {
      const args = buildCiVitestArgs({
        mode,
        project,
        shard,
        relatedPaths: ['src/renderer/App.tsx'],
      });
      expect(args).toContain(`--shard=${shard}`);
      expect(args.includes('--coverage')).toBe(mode === 'full');
      expect(args).toContain(`--reporter=${reporter}`);
      if (mode === 'related') {
        expect(args).toContain('src/renderer/App.tsx');
        expect(args).toContain('--reporter=default');
        expect(args).not.toContain('--reporter=blob');
      }
      return args.find((arg) => arg.startsWith(`--outputFile.${reporter}=`));
    });
    expect(new Set(outputs).size).toBe(5);
    expect(outputs[0]).toBe(
      mode === 'full'
        ? '--outputFile.blob=.vitest-reports/blob-renderer-ui-1-3.json'
        : '--outputFile.junit=test-results/junit-renderer-ui-1-3.xml',
    );
  });

  it.each(['0/3', '4/3', '1/0', '-1/3', '1.5/3', '1/3/4', 'invalid', '1/9007199254740992'])(
    'rejects invalid shard %s before invoking Vitest',
    (shard) => {
      const runVitestArgvFn = vi.fn();
      expect(() =>
        runCiVitest({ mode: 'full', project: 'main', shard }, { runVitestArgvFn }),
      ).toThrow('Invalid Vitest shard');
      expect(runVitestArgvFn).not.toHaveBeenCalled();
    },
  );

  it.each(['full', 'related'])('propagates a failing %s shard exit code', (mode) => {
    expect(
      runCiVitest(
        { mode, project: 'renderer-ui', shard: '2/3', relatedPaths: ['src/renderer/App.tsx'] },
        { runVitestArgvFn: () => 1 },
      ),
    ).toBe(1);
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
        '--passWithNoTests',
        '--reporter=default',
        '--reporter=junit',
        '--outputFile.junit=test-results/junit-main.xml',
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

  it('normalizes option-like relative paths before passing them to Vitest', () => {
    expect(normalizeRelatedPathForVitest('-dangerous.test.ts')).toBe('./-dangerous.test.ts');
    expect(normalizeRelatedPathForVitest('src/main/database.ts')).toBe('src/main/database.ts');
    expect(
      buildCiVitestArgs({
        mode: 'related',
        project: 'main',
        relatedPaths: ['-dangerous.test.ts'],
      }),
    ).toContain('./-dangerous.test.ts');
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
