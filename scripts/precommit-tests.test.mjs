// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  expandWithSiblingTests,
  isForceFullSuitePath,
  pickProjects,
  planPrecommitTests,
  runPrecommitTests,
  shouldForceFullSuite,
} from './precommit-tests.mjs';

describe('precommit-tests force-full', () => {
  it('detects vitest harness and lockfile', () => {
    expect(isForceFullSuitePath('vitest.harness.ts')).toBe(true);
    expect(isForceFullSuitePath('vitest.config.ts')).toBe(true);
    expect(isForceFullSuitePath('package.json')).toBe(true);
    expect(isForceFullSuitePath('pnpm-lock.yaml')).toBe(true);
    expect(isForceFullSuitePath('src/renderer/vitest.setup.ts')).toBe(true);
    expect(isForceFullSuitePath('src/shared/appTagline.ts')).toBe(false);
    expect(isForceFullSuitePath('src/preload/index.ts')).toBe(false);
  });

  it('plans full suite when lockfile staged', () => {
    const plan = planPrecommitTests(['pnpm-lock.yaml', 'README.md']);
    expect(plan.mode).toBe('full');
  });
});

describe('precommit-tests skip', () => {
  it('skips docs-only staged sets', () => {
    const plan = planPrecommitTests(['docs/ci-cd.md', 'README.md']);
    expect(plan.mode).toBe('skip');
    expect(plan.relatedPaths).toEqual([]);
  });
});

describe('precommit-tests related planning', () => {
  it('appends co-located sibling tests when present', () => {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-tests-sib-'));
    try {
      const libDir = path.join(fakeRoot, 'src', 'renderer', 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'foo.ts'), '');
      fs.writeFileSync(path.join(libDir, 'foo.test.ts'), '');

      const expanded = expandWithSiblingTests(['src/renderer/lib/foo.ts'], {
        root: fakeRoot,
        existsSync: (p) => fs.existsSync(p),
      });
      expect(expanded).toEqual(['src/renderer/lib/foo.test.ts', 'src/renderer/lib/foo.ts']);
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it('picks main only for shared/main/scripts paths', () => {
    expect(pickProjects(['src/shared/appTagline.ts', 'src/shared/appTagline.test.ts'])).toEqual([
      'main',
    ]);
    expect(pickProjects(['src/main/database.ts'])).toEqual(['main']);
    expect(pickProjects(['scripts/precommit-tests.mjs'])).toEqual(['main']);
  });

  it('picks renderer projects for lib paths (not main)', () => {
    expect(pickProjects(['src/renderer/lib/appTabMappings.ts'])).toEqual([
      'renderer-logic',
      'renderer-ui',
    ]);
  });

  it('plans related for a main source file', () => {
    const plan = planPrecommitTests(['src/main/foo.ts']);
    expect(plan.mode).toBe('related');
    expect(plan.projects).toEqual(['main']);
    expect(plan.relatedPaths).toContain('src/main/foo.ts');
  });
});

describe('precommit-tests runPrecommitTests', () => {
  it('skips spawn when docs-only', () => {
    const spawnSyncFn = vi.fn();
    const logs = [];
    const code = runPrecommitTests(['docs/ci-cd.md'], {
      spawnSyncFn,
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(spawnSyncFn).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes('skip Vitest'))).toBe(true);
  });

  it('spawns full vitest run for force-full', () => {
    const spawnSyncFn = vi.fn(() => ({ status: 0 }));
    const code = runPrecommitTests(['package.json'], {
      spawnSyncFn,
      log: () => {},
    });
    expect(code).toBe(0);
    expect(spawnSyncFn).toHaveBeenCalledTimes(1);
    const args = spawnSyncFn.mock.calls[0][1];
    expect(args).toEqual(['exec', 'vitest', 'run', '--bail', '1']);
  });

  it('spawns vitest related with main project for shared file', () => {
    const spawnSyncFn = vi.fn(() => ({ status: 0 }));
    const code = runPrecommitTests(['src/shared/appTagline.ts'], {
      spawnSyncFn,
      log: () => {},
    });
    expect(code).toBe(0);
    const args = spawnSyncFn.mock.calls[0][1];
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('vitest');
    expect(args[2]).toBe('related');
    expect(args).toContain('--project');
    expect(args).toContain('main');
    expect(args).toContain('src/shared/appTagline.ts');
    // Should not use `--` before related paths (breaks Vitest related).
    const relatedIdx = args.indexOf('src/shared/appTagline.ts');
    expect(args[relatedIdx - 1]).not.toBe('--');
  });
});

describe('precommit-tests shouldForceFullSuite', () => {
  it('is true when any force-full path is present', () => {
    expect(shouldForceFullSuite(['src/main/index.ts', 'vitest.config.ts'])).toBe(true);
    expect(shouldForceFullSuite(['src/main/index.ts'])).toBe(false);
  });
});
