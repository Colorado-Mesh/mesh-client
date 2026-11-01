// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  APP_ENTRY_CHUNK_BUDGET_KB,
  appChunkBudgetPlugin,
  appEntryChunkBudgetError,
  appEntryChunkBudgetErrorFromOutDir,
  isAppEntryChunk,
} from './app-chunk-budget.mjs';

const APP = '/workspace/src/renderer/App.tsx';

function chunk(code, extra = {}) {
  return {
    type: 'chunk',
    name: 'App',
    facadeModuleId: APP,
    code,
    ...extra,
  };
}

describe('isAppEntryChunk', () => {
  it('matches the App chunk and ignores the HTML entry and vendor chunks', () => {
    expect(isAppEntryChunk(chunk('x'), 'assets/App-abc.js')).toBe(true);
    expect(isAppEntryChunk({ type: 'chunk', name: 'App', code: 'x' }, 'assets/App-abc.js')).toBe(
      true,
    );
    expect(
      isAppEntryChunk(
        { type: 'chunk', facadeModuleId: 'C:\\repo\\src\\renderer\\App.tsx', code: 'x' },
        'assets/index-abc.js',
      ),
    ).toBe(true);
    expect(
      isAppEntryChunk(
        { type: 'chunk', name: 'index', facadeModuleId: '/repo/src/renderer/index.html' },
        'assets/index-abc.js',
      ),
    ).toBe(false);
    expect(
      isAppEntryChunk(
        { type: 'chunk', name: 'react', facadeModuleId: '/repo/node_modules/react/index.js' },
        'assets/react-aaa.js',
      ),
    ).toBe(false);
    expect(isAppEntryChunk({ type: 'asset', name: 'App' }, 'assets/App-abc.js')).toBe(false);
  });
});

describe('appEntryChunkBudgetError', () => {
  it('passes an App entry at or under 1000 kB', () => {
    const under = 'x'.repeat(APP_ENTRY_CHUNK_BUDGET_KB * 1000);
    expect(appEntryChunkBudgetError({ 'assets/App-abc.js': chunk(under) })).toBeNull();
    expect(appEntryChunkBudgetError({ 'assets/App-abc.js': chunk('tiny') })).toBeNull();
  });

  it('fails when the App entry exceeds 1000 kB', () => {
    const over = 'x'.repeat(APP_ENTRY_CHUNK_BUDGET_KB * 1000 + 1);
    const message = appEntryChunkBudgetError({ 'assets/App-abc.js': chunk(over) });
    expect(message).toMatch(/assets\/App-abc\.js/);
    expect(message).toMatch(/over the 1000 kB budget/);
  });

  it('ignores vendor chunks and fails closed when the App entry is missing', () => {
    const huge = 'x'.repeat(2_000_000);
    expect(
      appEntryChunkBudgetError({
        'assets/react-aaa.js': chunk(huge, {
          name: 'react',
          facadeModuleId: '/workspace/node_modules/react/index.js',
        }),
      }),
    ).toMatch(/not found/);
  });
});

describe('appEntryChunkBudgetErrorFromOutDir', () => {
  it('measures on-disk size so it matches the Vite chunk size reporter', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'app-chunk-budget-'));
    mkdirSync(path.join(dir, 'assets'));
    const rel = 'assets/App-abc.js';
    const over = 'x'.repeat(APP_ENTRY_CHUNK_BUDGET_KB * 1000 + 1);
    writeFileSync(path.join(dir, rel), over);
    const message = appEntryChunkBudgetErrorFromOutDir(
      { [rel]: { type: 'chunk', name: 'App', facadeModuleId: APP } },
      dir,
    );
    expect(message).toMatch(/assets\/App-abc\.js/);
    expect(message).toMatch(/over the 1000 kB budget/);
  });
});

describe('appChunkBudgetPlugin', () => {
  it('calls this.error from writeBundle when the on-disk App chunk exceeds the budget', () => {
    const plugin = appChunkBudgetPlugin();
    const dir = mkdtempSync(path.join(tmpdir(), 'app-chunk-budget-plugin-'));
    mkdirSync(path.join(dir, 'assets'));
    const rel = 'assets/App-abc.js';
    writeFileSync(path.join(dir, rel), 'x'.repeat(APP_ENTRY_CHUNK_BUDGET_KB * 1000 + 1));

    plugin.configResolved({ build: { outDir: dir } });
    const bad = { error: vi.fn() };
    plugin.writeBundle.call(
      bad,
      {},
      { [rel]: { type: 'chunk', name: 'App', facadeModuleId: APP } },
    );
    expect(bad.error).toHaveBeenCalledOnce();

    writeFileSync(path.join(dir, rel), 'tiny');
    const ok = { error: vi.fn() };
    plugin.writeBundle.call(ok, {}, { [rel]: { type: 'chunk', name: 'App', facadeModuleId: APP } });
    expect(ok.error).not.toHaveBeenCalled();
  });
});
