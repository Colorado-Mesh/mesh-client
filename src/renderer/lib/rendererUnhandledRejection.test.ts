import { afterEach, describe, expect, it, vi } from 'vitest';

import { logRendererUnhandledRejection } from './rendererUnhandledRejection';

describe('logRendererUnhandledRejection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an Error stack when available', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('renderer failed');
    error.stack = 'Error: renderer failed\n    at test';

    logRendererUnhandledRejection(error);

    expect(spy).toHaveBeenCalledWith('[renderer] Unhandled rejection:', error.stack);
  });

  it('logs a non-Error reason using String conversion', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logRendererUnhandledRejection({ code: 42 });

    expect(spy).toHaveBeenCalledWith('[renderer] Unhandled rejection:', '[object Object]');
  });
});
