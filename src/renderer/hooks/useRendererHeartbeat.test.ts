// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRendererHeartbeat } from './useRendererHeartbeat';

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

describe('useRendererHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    setDocumentHidden(false);
  });

  it('sends an immediate heartbeat on mount when the document is visible', () => {
    renderHook(() => {
      useRendererHeartbeat();
    });
    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it('re-sends every 30s while visible', () => {
    renderHook(() => {
      useRendererHeartbeat();
    });
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();

    vi.advanceTimersByTime(30_000);
    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('does not send an initial heartbeat when the document starts hidden', () => {
    setDocumentHidden(true);
    renderHook(() => {
      useRendererHeartbeat();
    });
    expect(window.electronAPI.sendRendererHeartbeat).not.toHaveBeenCalled();
  });

  it('stops the interval when the document becomes hidden', () => {
    renderHook(() => {
      useRendererHeartbeat();
    });
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();

    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(90_000);
    expect(window.electronAPI.sendRendererHeartbeat).not.toHaveBeenCalled();
  });

  it('resumes heartbeats (with an immediate send) when the document becomes visible again', () => {
    renderHook(() => {
      useRendererHeartbeat();
    });
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('does not double-start the interval on repeated visible visibilitychange events', () => {
    renderHook(() => {
      useRendererHeartbeat();
    });
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();

    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(30_000);
    // A double-started interval would fire the 30s tick twice.
    expect(window.electronAPI.sendRendererHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('logs at debug level (does not throw) when the IPC send rejects', async () => {
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockRejectedValueOnce(
      new Error('ipc down'),
    );
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    renderHook(() => {
      useRendererHeartbeat();
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(debugSpy).toHaveBeenCalledWith('[useRendererHeartbeat] send failed', expect.any(Error));
    debugSpy.mockRestore();
  });

  it('clears the interval and listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => {
      useRendererHeartbeat();
    });
    vi.mocked(window.electronAPI.sendRendererHeartbeat).mockClear();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    vi.advanceTimersByTime(60_000);
    expect(window.electronAPI.sendRendererHeartbeat).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });
});
