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

function dispatchUnhandledRejection(
  reason: unknown,
  opts?: { preventDefaultFirst?: boolean },
): void {
  const event = new Event('unhandledrejection', { cancelable: true });
  Object.assign(event, { reason });
  if (opts?.preventDefaultFirst) {
    event.preventDefault();
  }
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

  it('skips console.error when defaultPrevented (capture-phase Meshtastic handler)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const uninstall = installRendererUnhandledRejectionLogger();

    dispatchUnhandledRejection(new Error('queue rejected'), { preventDefaultFirst: true });
    uninstall();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not log Packet does not exist as Unhandled rejection', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const uninstall = installRendererUnhandledRejectionLogger();

    dispatchUnhandledRejection(new Error('Packet does not exist'));
    uninstall();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      '[renderer] Ignoring Meshtastic disconnect mid-send rejection:',
      'Packet does not exist',
    );
  });
});
