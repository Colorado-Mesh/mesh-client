// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installRendererUnhandledRejectionLogger,
  logRendererUnhandledRejection,
} from './rendererUnhandledRejection';

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

function dispatchUnhandledRejection(reason: unknown): void {
  const event = new Event('unhandledrejection');
  Object.assign(event, { reason });
  window.dispatchEvent(event);
}

describe('installRendererUnhandledRejectionLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs rejections dispatched on the window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installRendererUnhandledRejectionLogger();

    dispatchUnhandledRejection('boom');
    uninstall();

    expect(spy).toHaveBeenCalledWith('[renderer] Unhandled rejection:', 'boom');
  });

  it('stops logging after the returned cleanup runs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installRendererUnhandledRejectionLogger();
    uninstall();

    dispatchUnhandledRejection('boom');

    expect(spy).not.toHaveBeenCalled();
  });
});
