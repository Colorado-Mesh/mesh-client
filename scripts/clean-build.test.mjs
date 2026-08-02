// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  confirmProceed,
  filterPaths,
  parseFlags,
  pathExists,
  planReinstall,
  printPlan,
  resolvePaths,
  runClean,
  runCmd,
} from './clean-build.mjs';

const RAW_TIERS = [
  { name: 'dist', tier: 1 },
  { name: 'dist-electron', tier: 1 },
  { name: 'node_modules', tier: 2 },
  { name: 'reticulum-sidecar/target', tier: 2 },
];

describe('clean-build', () => {
  /** @type {string[]} */
  const tempRoots = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function makeTempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'clean-build-'));
    tempRoots.push(root);
    return root;
  }

  /** @param {string} text */
  function readableTty(text) {
    const stream = Readable.from(text);
    stream.isTTY = true;
    return stream;
  }

  /** @type {{write(s: string): void}} */
  const silent = {
    write() {
      void 0;
    },
  };

  it('parseFlags rejects unknown flags', () => {
    expect(() => parseFlags(['--bogus'])).toThrow(/unknown argument/);
    expect(parseFlags(['--full', '-y'])).toEqual({ full: true, yes: true });
    expect(parseFlags([])).toEqual({ full: false, yes: false });
    expect(parseFlags(['--', '-y'])).toEqual({ full: false, yes: true });
  });

  it('resolvePaths stays inside rootDir and rejects escapes', () => {
    const root = makeTempRoot();
    const resolved = resolvePaths(root, RAW_TIERS);
    for (const entry of resolved) expect(entry.abs.startsWith(root)).toBe(true);
    expect(() => resolvePaths(root, [{ name: '../outside', tier: 2 }])).toThrow(
      /outside repo root/,
    );
  });

  it('resolvePaths rejects a symbolic-link ancestor pointing outside rootDir', () => {
    const root = makeTempDir();
    const outside = makeTempRoot();
    try {
      symlinkSync(outside, join(root, 'reticulum-sidecar'), 'dir');
    } catch {
      return; // symlinks unavailable on this platform
    }
    expect(() => resolvePaths(root, [{ name: 'reticulum-sidecar/target', tier: 2 }])).toThrow(
      /symlink ancestor/,
    );
  });

  it('filterPaths: shallow keeps tier 1 only', () => {
    const resolved = resolvePaths(makeTempRoot(), RAW_TIERS);
    expect(filterPaths(false, resolved).map((e) => e.tier)).toEqual([1, 1]);
    expect(filterPaths(true, resolved).map((e) => e.tier)).toEqual([1, 1, 2, 2]);
  });

  it('pathExists treats symlinks (including dangling) as present; ENOENT is absent', () => {
    const root = makeTempDir();
    expect(pathExists(join(root, 'missing'))).toBe(false);
    mkdirSync(join(root, 'real'), { recursive: true });
    expect(pathExists(join(root, 'real'))).toBe(true);
    try {
      symlinkSync(join(root, 'real', 'nope'), join(root, 'dangling'), 'dir');
    } catch {
      return; // symlinks unavailable
    }
    expect(existsSync(join(root, 'dangling'))).toBe(false);
    expect(pathExists(join(root, 'dangling'))).toBe(true);
  });

  it('planReinstall only triggers when a tier-2 path exists', () => {
    const none = resolvePaths(makeTempRoot(), RAW_TIERS);
    expect(planReinstall(true, none)).toEqual({ install: false, sidecar: false });

    mkdirSync(join(makeTempRoot(), 'node_modules'), { recursive: true });
    const present = resolvePaths(tempRoots[tempRoots.length - 1], RAW_TIERS);
    expect(planReinstall(true, present)).toEqual({ install: true, sidecar: true });
  });

  it('planReinstall treats a dangling tier-2 symlink as present', () => {
    const root = makeTempDir();
    try {
      symlinkSync(join(root, 'missing-target'), join(root, 'node_modules'), 'dir');
    } catch {
      return; // symlinks unavailable
    }
    const present = resolvePaths(root, RAW_TIERS);
    expect(planReinstall(true, present).install).toBe(true);
  });

  it('printPlan writes the full plan to the supplied stream', () => {
    const lines = [];
    const out = {
      write(s) {
        lines.push(s);
      },
    };
    printPlan(out, true, [{ name: 'node_modules' }], { install: true, sidecar: true });
    expect(lines.join('')).toContain('This will remove:');
    expect(lines.join('')).toContain('  - node_modules');
    expect(lines.join('')).toContain('  - pnpm run reticulum:sidecar:build');
  });

  it('runCmd routes through the shell on win32 and not on other platforms', () => {
    const win = [];
    const code = runCmd(['pnpm', 'install'], '/cwd', 'win32', (cmd, args, opts) => {
      win.push({ cmd, args, opts });
      return { status: 0 };
    });
    expect(code).toBe(0);
    expect(win).toHaveLength(1);
    expect(win[0].cmd).toBe('pnpm');
    expect(win[0].opts.shell).toBe(true);

    const unix = [];
    runCmd(['pnpm', 'install'], '/cwd', 'darwin', (cmd, args, opts) => {
      unix.push(opts);
      return { status: 0 };
    });
    expect(unix[0].shell).toBe(false);
  });

  it('confirmProceed: explicit y confirms, n/empty aborts, non-TTY aborts, --yes confirms', async () => {
    expect(await confirmProceed(readableTty('y\n'), silent, false)).toBe(true);
    expect(await confirmProceed(readableTty('Y\n'), silent, false)).toBe(true);
    expect(await confirmProceed(readableTty('n\n'), silent, false)).toBe(false);
    expect(await confirmProceed(Readable.from(''), silent, false)).toBe(false);
    expect(await confirmProceed(Readable.from(''), silent, true)).toBe(true);
  });

  it('shallow clean (-y) removes tier 1, keeps node_modules and unlisted files', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'dist-electron'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), 'x');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'docs.md'), 'keep');
    const run = () => {
      throw new Error('no reinstall expected for shallow');
    };

    const result = await runClean(root, ['-y'], { stdin: process.stdin, stdout: silent, run });

    expect(result.reinstalled).toBe(false);
    expect(result.removed.sort()).toEqual(['dist', 'dist-electron']);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(existsSync(join(root, 'node_modules'))).toBe(true);
    expect(existsSync(join(root, 'docs.md'))).toBe(true);
  });

  it('aborts without deleting when stdin is not a TTY and no -y', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'dist'), { recursive: true });
    const run = () => {
      throw new Error('no reinstall expected');
    };

    const result = await runClean(root, [], { stdin: Readable.from(''), stdout: silent, run });

    expect(result).toEqual({ removed: [], reinstalled: false });
    expect(existsSync(join(root, 'dist'))).toBe(true);
  });

  it('aborts (nothing removed) when the user answers n', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'dist'), { recursive: true });
    const run = () => {
      throw new Error('no reinstall expected');
    };

    const result = await runClean(root, [], { stdin: readableTty('n\n'), stdout: silent, run });

    expect(result).toEqual({ removed: [], reinstalled: false });
    expect(existsSync(join(root, 'dist'))).toBe(true);
  });

  it('full clean removes tier 1 + tier 2 and reinstalls when tier 2 was present', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd.join(' '));
      return 0;
    };

    const result = await runClean(root, ['--full', '-y'], {
      stdin: process.stdin,
      stdout: silent,
      run,
    });

    expect(result.reinstalled).toBe(true);
    expect(result.removed.sort()).toEqual(['dist', 'node_modules']);
    expect(calls).toEqual(['pnpm install', 'pnpm run reticulum:sidecar:build']);
  });

  it('full clean throws RESTORE_FAILED when pnpm install fails, preserving removed state', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const run = () => 1;

    await expect(
      runClean(root, ['--full', '-y'], { stdin: process.stdin, stdout: silent, run }),
    ).rejects.toMatchObject({ code: 'RESTORE_FAILED', removed: ['node_modules'] });
  });

  it('full clean throws RESTORE_FAILED when the sidecar rebuild fails, preserving removed state', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd.join(' '));
      return cmd[0] === 'pnpm' && cmd[2] === 'reticulum:sidecar:build' ? 1 : 0;
    };

    await expect(
      runClean(root, ['--full', '-y'], { stdin: process.stdin, stdout: silent, run }),
    ).rejects.toMatchObject({ code: 'RESTORE_FAILED', removed: ['node_modules'] });
    expect(calls).toEqual(['pnpm install', 'pnpm run reticulum:sidecar:build']);
  });

  it('does not reinstall when nothing existed to clean', async () => {
    const root = makeTempDir();
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd.join(' '));
      return 0;
    };

    const result = await runClean(root, ['--full', '-y'], {
      stdin: process.stdin,
      stdout: silent,
      run,
    });

    expect(result.removed).toEqual([]);
    expect(result.reinstalled).toBe(false);
    expect(calls).toEqual([]);
  });

  function makeTempDir() {
    return makeTempRoot();
  }
});
