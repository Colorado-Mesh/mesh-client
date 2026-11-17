import { afterEach, describe, expect, it, vi } from 'vitest';

describe('perfTrace', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('is disabled when localStorage is missing or unset', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
    });
    const mod = await import('./perfTrace');
    expect(mod.PERF_TRACE_ENABLED).toBe(false);
    const fn = vi.fn(() => 42);
    expect(mod.perfSpanSync('t', fn)).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('records spans when enabled via localStorage', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'mesh-client:perf' ? '1' : null),
    });
    const mod = await import('./perfTrace');
    expect(mod.PERF_TRACE_ENABLED).toBe(true);
    mod.perfReset();
    mod.perfSpanSync('unit-span', () => 'ok');
    mod.perfSpan('unit-span', () => undefined);
    const table = vi.spyOn(console, 'table').mockImplementation(() => {});
    mod.perfReport();
    expect(table).toHaveBeenCalledOnce();
    const rows = table.mock.calls[0]?.[0] as { name: string; count: number }[];
    expect(rows.some((r) => r.name === 'unit-span' && r.count === 2)).toBe(true);
    table.mockRestore();
  });
});
