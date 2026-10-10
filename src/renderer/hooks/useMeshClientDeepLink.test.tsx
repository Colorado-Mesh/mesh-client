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

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { MeshClientDeepLinkHost } from './useMeshClientDeepLink';

const MC_PUB = 'c'.repeat(64);
const MC_SECRET = 'd'.repeat(32);

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
    window.electronAPI.db.saveMeshcoreContact = vi.fn().mockResolvedValue(undefined);
  });

  it('imports meshcore contact after confirm', async () => {
    const user = userEvent.setup();
    render(<MeshClientDeepLinkHost />);
    const uri = `meshcore://contact/add?name=Bob&public_key=${MC_PUB}&type=1`;
    await act(async () => {
      openUrlHandler?.(uri);
      await Promise.resolve();
    });
    expect(window.electronAPI.db.saveMeshcoreContact).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'qrIngest.confirmMeshcoreContactImportAction' }),
    );
    await waitFor(() => {
      expect(window.electronAPI.db.saveMeshcoreContact).toHaveBeenCalledWith(
        expect.objectContaining({
          public_key: MC_PUB,
          adv_name: 'Bob',
          contact_type: 1,
          on_radio: 0,
        }),
      );
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.meshcoreContactImported', 'success');
  });

  it.each(['', '&region_scope=%23metro', '&mesh_client_scope=unscoped'])(
    'dispatches meshcore channel scope after confirm: %s',
    async (scopeQuery) => {
      const user = userEvent.setup();
      const spy = vi.fn();
      window.addEventListener('mesh-client:meshcoreChannelFromQr', spy as EventListener);
      try {
        render(<MeshClientDeepLinkHost />);
        const uri = `meshcore://channel/add?name=Public&secret=${MC_SECRET}${scopeQuery}`;
        await act(async () => {
          openUrlHandler?.(uri);
          await Promise.resolve();
        });
        await user.click(
          screen.getByRole('button', { name: 'qrIngest.confirmMeshcoreChannelImportAction' }),
        );
        await waitFor(() => {
          expect(spy).toHaveBeenCalled();
        });
        expect((spy.mock.calls[0][0] as CustomEvent).detail.regionScope).toBe(
          scopeQuery.includes('unscoped') ? '' : scopeQuery ? '#metro' : undefined,
        );
        // No MeshcoreChannelSection consumer → deferred / queued-for-review toast; pending kept.
        expect(addToast).toHaveBeenCalledWith('qrIngest.meshcoreChannelImported', 'success');
        expect(
          screen.getByRole('button', { name: 'qrIngest.confirmMeshcoreChannelImportAction' }),
        ).toBeTruthy();
      } finally {
        window.removeEventListener('mesh-client:meshcoreChannelFromQr', spy as EventListener);
      }
    },
  );

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
