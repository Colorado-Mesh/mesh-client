// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ESLINT_SHARD_ARGS,
  listGitVisibleFiles,
  MAX_ESLINT_SHARDS,
  parseGitFileList,
  parseShardSpec,
  runEslintShard,
  selectShardFiles,
} from './ci-eslint-shard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A throwaway Git repository with tracked, untracked, ignored and deleted files. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-eslint-shard-'));
  tempDirs.push(dir);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  };
  git('init', '--quiet');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
  fs.writeFileSync(path.join(dir, 'src', 'tracked.ts'), 'export {};\n');
  fs.writeFileSync(path.join(dir, 'src', 'deleted.ts'), 'export {};\n');
  fs.writeFileSync(path.join(dir, 'dist', 'ignored.js'), '\n');
  git('add', '.');
  fs.writeFileSync(path.join(dir, 'src', 'untracked.ts'), 'export {};\n');
  fs.rmSync(path.join(dir, 'src', 'deleted.ts'));
  return dir;
}

describe('ci-eslint-shard', () => {
  it('parses a 1-based shard spec and rejects anything else', () => {
    expect(parseShardSpec('1/4')).toEqual({ index: 1, total: 4 });
    expect(parseShardSpec(' 4/4 ')).toEqual({ index: 4, total: 4 });
    expect(parseShardSpec('1/1')).toEqual({ index: 1, total: 1 });
    for (const spec of [undefined, '', '0/4', '5/4', '1/0', '1', '1/4/2', 'a/b', '-1/4', '1/400']) {
      expect(() => parseShardSpec(spec), String(spec)).toThrow(/ci-eslint-shard/);
    }
    expect(() => parseShardSpec(`1/${String(MAX_ESLINT_SHARDS + 1)}`)).toThrow(/out of range/);
  });

  it.each([1, 2, 3, 4, 5, 7, MAX_ESLINT_SHARDS])(
    'gives every file to exactly one of %i shards',
    (total) => {
      const files = Array.from(
        { length: 103 },
        (_unused, n) => `src/dir${String(n % 9)}/f${String(n)}.ts`,
      );
      const shards = Array.from({ length: total }, (_unused, n) =>
        selectShardFiles(files, n + 1, total),
      );
      const union = shards.flat();
      expect(union).toHaveLength(files.length);
      expect(new Set(union)).toEqual(new Set(files));
      const sizes = shards.map((shard) => shard.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    },
  );

  it('assigns shards from the sorted paths, whatever order Git lists them in', () => {
    const files = ['b.ts', 'a.ts', 'd.ts', 'c.ts', 'a.ts'];
    expect(selectShardFiles(files, 1, 2)).toEqual(['a.ts', 'c.ts']);
    expect(selectShardFiles(files, 2, 2)).toEqual(['b.ts', 'd.ts']);
    expect(selectShardFiles([...files].reverse(), 1, 2)).toEqual(['a.ts', 'c.ts']);
  });

  it('splits NUL-separated Git output, keeping names that contain spaces or newlines', () => {
    expect(parseGitFileList('a.ts\0dir/b c.ts\0odd\nname.ts\0')).toEqual([
      'a.ts',
      'dir/b c.ts',
      'odd\nname.ts',
    ]);
    expect(parseGitFileList('')).toEqual([]);
  });

  it('lists tracked and untracked files but not ignored or deleted ones', () => {
    const dir = makeRepo();
    expect(listGitVisibleFiles({ root: dir }).sort()).toEqual([
      '.gitignore',
      'src/tracked.ts',
      'src/untracked.ts',
    ]);
  });

  it('fails when Git cannot list files instead of linting nothing', () => {
    const failing = () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' });
    expect(() => listGitVisibleFiles({ root: ROOT, spawnSyncFn: failing })).toThrow(
      /git ls-files exited 128/,
    );
    const empty = () => ({ status: 0, stdout: '', stderr: '' });
    expect(() => runEslintShard({ spec: '1/2', root: ROOT, spawnSyncFn: empty })).toThrow(
      /refusing to pass an empty lint/,
    );
  });

  it('runs ESLint once with the CI flags and only its own shard of the files', () => {
    const dir = makeRepo();
    /** @type {{ command: string, args: string[] }[]} */
    const calls = [];
    const spawnSyncFn = (command, args, options) => {
      if (command === 'git') return spawnSync(command, args, options);
      calls.push({ command, args });
      return { status: 3 };
    };
    const status = runEslintShard({ spec: '2/2', root: dir, spawnSyncFn, log: () => {} });
    expect(status).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args[0]).toMatch(/eslint[/\\]bin[/\\]eslint\.js$/);
    expect(calls[0].args.slice(1, 1 + ESLINT_SHARD_ARGS.length)).toEqual([...ESLINT_SHARD_ARGS]);
    // .gitignore, src/tracked.ts, src/untracked.ts sorted; shard 2 of 2 is the middle one.
    expect(calls[0].args.slice(1 + ESLINT_SHARD_ARGS.length)).toEqual(['src/tracked.ts']);
  });

  it('treats a killed ESLint (no exit status) as a failure', () => {
    const spawnSyncFn = (command, args, options) =>
      command === 'git' ? spawnSync(command, args, options) : { status: null, signal: 'SIGKILL' };
    expect(runEslintShard({ spec: '1/1', root: ROOT, spawnSyncFn, log: () => {} })).toBe(1);
  });

  it('keeps the zero-warning gate, the CI config and two workers on every shard', () => {
    expect(ESLINT_SHARD_ARGS.join(' ')).toBe(
      '--max-warnings 0 --concurrency 2 --config eslint.ci.config.mjs --no-warn-ignored',
    );
    const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts.lint).toBe('eslint . --max-warnings 0');
  });

  it('is wired into ci.yaml as a complete matrix behind the required aggregate job', () => {
    const workflow = load(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yaml'), 'utf8'));
    const lint = workflow.jobs.lint;
    // ESLINT_SHARD takes its total from strategy.job-total, so a second matrix dimension
    // would raise the total and leave the extra shards unrun.
    expect(Object.keys(lint.strategy.matrix)).toEqual(['shard']);
    const shards = lint.strategy.matrix.shard;
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.length).toBeLessThanOrEqual(MAX_ESLINT_SHARDS);
    expect(shards).toEqual(shards.map((_shard, position) => position + 1));
    expect(lint.strategy['fail-fast']).toBe(false);
    expect(lint.name).toBe('ESLint (${{ matrix.shard }}/${{ strategy.job-total }})');
    expect(lint.if).toBeUndefined();
    expect(lint['continue-on-error']).toBeUndefined();
    const run = lint.steps.find((step) => step.run?.includes('ci-eslint-shard'));
    expect(run.run).toBe('node scripts/ci-eslint-shard.mjs');
    expect(run.env).toEqual({ ESLINT_SHARD: '${{ matrix.shard }}/${{ strategy.job-total }}' });
    expect(run.if).toBeUndefined();
    expect(run['continue-on-error']).toBeUndefined();
    expect(workflow.jobs.build.needs).toContain('lint');
    expect(workflow.jobs.build.env.LINT_RESULT).toBe('${{ needs.lint.result }}');
  });
});
