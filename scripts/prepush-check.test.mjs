// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  collectChangedPathsForCheck,
  runCheckChanged,
  runEslintOnChangedFiles,
  spawnExitCode,
} from './prepush-check.mjs';

describe('prepush-check', () => {
  it('spawnExitCode treats signals and null status as failure', () => {
    expect(spawnExitCode(0, null)).toBe(0);
    expect(spawnExitCode(1, null)).toBe(1);
    expect(spawnExitCode(0, 'SIGKILL')).toBe(1);
    expect(spawnExitCode(null, null)).toBe(1);
  });

  it('collectChangedPathsForCheck unions merge-base, HEAD, and staged paths', () => {
    const calls = [];
    const spawnSyncFn = vi.fn((cmd, args) => {
      calls.push(args);
      if (args[0] === 'diff' && args.includes('origin-merge')) {
        return { status: 0, stdout: 'package.json\n', stderr: '' };
      }
      if (args[0] === 'diff' && args[1] === '--name-only' && args[2] === 'HEAD') {
        return { status: 0, stdout: 'scripts/prepush-check.mjs\n', stderr: '' };
      }
      if (args[0] === 'diff' && args[1] === '--cached') {
        return { status: 0, stdout: 'AGENTS.md\n', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const paths = collectChangedPathsForCheck({
      mergeBase: 'origin-merge',
      cwd: process.cwd(),
      spawnSyncFn,
    });

    expect(paths).toEqual(
      ['AGENTS.md', 'package.json', 'scripts/prepush-check.mjs'].sort((a, b) => a.localeCompare(b)),
    );
    expect(calls.some((args) => args[0] === 'diff' && args.includes('origin-merge'))).toBe(true);
    expect(calls.some((args) => args[0] === 'diff' && args[2] === 'HEAD')).toBe(true);
    expect(calls.some((args) => args[0] === 'diff' && args.includes('--cached'))).toBe(true);
  });

  it('runEslintOnChangedFiles propagates non-zero eslint exit', () => {
    const spawnSyncFn = vi.fn(() => ({
      status: 2,
      stdout: '',
      stderr: 'lint error',
      signal: null,
    }));
    const code = runEslintOnChangedFiles(['scripts/prepush-check.mjs'], {
      cwd: process.cwd(),
      spawnSyncFn,
      env: { NODE_OPTIONS: '--max-old-space-size=2048' },
    });
    expect(code).toBe(2);
    expect(spawnSyncFn).toHaveBeenCalled();
  });

  it('runCheckChanged stops after eslint failure without running typecheck', () => {
    const spawnSyncFn = vi.fn((cmd, args) => {
      if (cmd === 'git') {
        return { status: 0, stdout: 'scripts/prepush-check.mjs\n', stderr: '' };
      }
      if (cmd === 'pnpm' && args[0] === 'exec' && args[1] === 'prettier') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === process.execPath) {
        return { status: 1, stdout: '', stderr: '', signal: null };
      }
      return { status: 0, stdout: '', stderr: '' };
    });

    const code = runCheckChanged({
      mergeBase: 'deadbeef',
      cwd: process.cwd(),
      spawnSyncFn,
    });
    expect(code).toBe(1);
    expect(spawnSyncFn).not.toHaveBeenCalledWith('pnpm', ['run', 'typecheck'], expect.anything());
  });
});
