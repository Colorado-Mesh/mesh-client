import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();
const onOpenUrl = vi.fn();
let openUrlHandler: ((url: string) => void) | null = null;

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { useMeshClientDeepLink } from './useMeshClientDeepLink';

describe('useMeshClientDeepLink', () => {
  beforeEach(() => {
    addToast.mockReset();
    onOpenUrl.mockReset();
    openUrlHandler = null;
    window.electronAPI.deepLink = {
      onOpenUrl: (cb: (url: string) => void) => {
        openUrlHandler = cb;
        onOpenUrl(cb);
        return () => {
          openUrlHandler = null;
        };
      },
    };
    window.electronAPI.db.upsertReticulumDestination = vi.fn().mockResolvedValue({ changes: 1 });
  });

  it('upserts lxm contact deep links', async () => {
    renderHook(() => {
      useMeshClientDeepLink();
    });
    expect(openUrlHandler).toBeTruthy();
    await act(async () => {
      openUrlHandler?.('lxm://contact/0123456789abcdef0123456789abcdef?name=Alice');
      await Promise.resolve();
    });
    expect(window.electronAPI.db.upsertReticulumDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        destination_hash: '0123456789abcdef0123456789abcdef',
        display_name: 'Alice',
      }),
    );
    expect(addToast).toHaveBeenCalledWith('qrIngest.contactImported', 'success');
  });

  it('soft-fails encrypted paper links', async () => {
    renderHook(() => {
      useMeshClientDeepLink();
    });
    await act(async () => {
      openUrlHandler?.('lxm://paper/not-a-supported-form');
      await Promise.resolve();
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.paperUnsupported', 'error');
  });

  it('dispatches meshtastic channel URLs for RadioPanel', async () => {
    const spy = vi.fn();
    window.addEventListener('mesh-client:meshtasticChannelUrl', spy as EventListener);
    renderHook(() => {
      useMeshClientDeepLink();
    });
    await act(async () => {
      openUrlHandler?.('https://meshtastic.org/e/#abc');
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('qrIngest.channelLinkReceived', 'success');
    window.removeEventListener('mesh-client:meshtasticChannelUrl', spy as EventListener);
  });
});
