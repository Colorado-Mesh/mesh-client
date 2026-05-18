import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeClipboardText } from './writeClipboardText';

describe('writeClipboardText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses electronAPI.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', {
      ...window.electronAPI,
      clipboard: { writeText },
    });

    await writeClipboardText('hello from electron');

    expect(writeText).toHaveBeenCalledWith('hello from electron');
  });

  it('throws when neither electronAPI nor navigator.clipboard is available', async () => {
    vi.stubGlobal('electronAPI', {
      ...window.electronAPI,
      clipboard: {} as { writeText: (text: string) => void },
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: {},
      writable: true,
      configurable: true,
    });

    await expect(writeClipboardText('no api')).rejects.toThrow('Clipboard API unavailable');
  });

  it('falls back to navigator.clipboard.writeText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('electronAPI', {
      ...window.electronAPI,
      clipboard: {} as { writeText: (text: string) => void },
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    await writeClipboardText('hello from web');

    expect(writeText).toHaveBeenCalledWith('hello from web');
  });

  it('propagates navigator.clipboard.writeText rejection', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('electronAPI', {
      ...window.electronAPI,
      clipboard: {} as { writeText: (text: string) => void },
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    await expect(writeClipboardText('blocked')).rejects.toThrow('NotAllowedError');
  });
});
