// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  APP_ENTRY_CHUNK_BUDGET_KB,
  appChunkBudgetPlugin,
  appEntryChunkBudgetError,
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

describe('appChunkBudgetPlugin', () => {
  it('calls this.error only when the budget is exceeded', () => {
    const plugin = appChunkBudgetPlugin();
    const ok = { error: vi.fn() };
    plugin.generateBundle.call(ok, {}, { 'assets/App-abc.js': chunk('ok') });
    expect(ok.error).not.toHaveBeenCalled();

    const bad = { error: vi.fn() };
    plugin.generateBundle.call(
      bad,
      {},
      {
        'assets/App-abc.js': chunk('x'.repeat(APP_ENTRY_CHUNK_BUDGET_KB * 1000 + 1)),
      },
    );
    expect(bad.error).toHaveBeenCalledOnce();
  });
});
