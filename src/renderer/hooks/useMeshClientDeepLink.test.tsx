import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addToast = vi.fn();
const onOpenUrl = vi.fn();
let openUrlHandler: ((url: string) => void) | null = null;

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));

import { MeshClientDeepLinkHost } from './useMeshClientDeepLink';

describe('MeshClientDeepLinkHost', () => {
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

  it('requires confirmation before upserting lxm contact deep links', async () => {
    const user = userEvent.setup();
    render(<MeshClientDeepLinkHost />);
    expect(openUrlHandler).toBeTruthy();
    await act(async () => {
      openUrlHandler?.('lxm://contact/0123456789abcdef0123456789abcdef?name=Alice');
      await Promise.resolve();
    });
    expect(window.electronAPI.db.upsertReticulumDestination).not.toHaveBeenCalled();
    expect(screen.getByText('qrIngest.confirmContactImportTitle')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'qrIngest.confirmContactImportAction' }));
    await waitFor(() => {
      expect(window.electronAPI.db.upsertReticulumDestination).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_hash: '0123456789abcdef0123456789abcdef',
          display_name: 'Alice',
          last_heard: expect.any(Number),
        }),
      );
    });
    const call = vi.mocked(window.electronAPI.db.upsertReticulumDestination).mock.calls[0]?.[0] as {
      last_heard: number;
    };
    expect(call.last_heard).toBeLessThan(1e12);
    expect(addToast).toHaveBeenCalledWith('qrIngest.contactImported', 'success');
  });

  it('soft-fails encrypted paper links', async () => {
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.('lxm://paper/not-a-supported-form');
      await Promise.resolve();
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.paperUnsupported', 'error');
  });

  it('dispatches meshtastic channel URLs for RadioPanel', async () => {
    const spy = vi.fn();
    window.addEventListener('mesh-client:meshtasticChannelUrl', spy as EventListener);
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.('https://meshtastic.org/e/#abc');
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('qrIngest.channelLinkReceived', 'success');
    window.removeEventListener('mesh-client:meshtasticChannelUrl', spy as EventListener);
  });
});
