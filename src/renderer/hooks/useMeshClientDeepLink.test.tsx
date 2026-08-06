import { act, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  registerReticulumKnownIdentity: vi.fn(),
}));

vi.mock('@/renderer/stores/reticulumPeerStore', () => ({
  refreshReticulumPeersFromSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { registerReticulumKnownIdentity } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import { MeshClientDeepLinkHost } from './useMeshClientDeepLink';

const LXMA_DEST = 'a'.repeat(32);
const LXMA_PUB = 'b'.repeat(128);
const MC_PUB = 'c'.repeat(64);
const MC_SECRET = 'd'.repeat(32);

describe('MeshClientDeepLinkHost', () => {
  beforeEach(() => {
    addToast.mockReset();
    onOpenUrl.mockReset();
    openUrlHandler = null;
    vi.mocked(registerReticulumKnownIdentity).mockReset();
    vi.mocked(registerReticulumKnownIdentity).mockResolvedValue({ ok: true });
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
    window.electronAPI.db.saveMeshcoreContact = vi.fn().mockResolvedValue(undefined);
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

  it('imports lxma contact after confirm (register-known + is_contact)', async () => {
    const user = userEvent.setup();
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(`lxma://${LXMA_DEST}:${LXMA_PUB}`);
      await Promise.resolve();
    });
    expect(registerReticulumKnownIdentity).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'qrIngest.confirmContactImportAction' }));
    await waitFor(() => {
      expect(registerReticulumKnownIdentity).toHaveBeenCalledWith(LXMA_DEST, LXMA_PUB);
      expect(window.electronAPI.db.upsertReticulumDestination).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_hash: LXMA_DEST,
          is_contact: true,
        }),
      );
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.contactImported', 'success');
  });

  it('toasts when lxma register-known fails without upsert', async () => {
    const user = userEvent.setup();
    vi.mocked(registerReticulumKnownIdentity).mockResolvedValue({
      ok: false,
      error: 'sidecar_not_running',
    });
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(`lxma://${LXMA_DEST}:${LXMA_PUB}`);
      await Promise.resolve();
    });
    await user.click(screen.getByRole('button', { name: 'qrIngest.confirmContactImportAction' }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('qrIngest.lxmaRegisterFailed', 'error');
    });
    expect(window.electronAPI.db.upsertReticulumDestination).not.toHaveBeenCalled();
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

  it('dispatches meshcore channel import event after confirm', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    window.addEventListener('mesh-client:meshcoreChannelFromQr', spy as EventListener);
    try {
      render(<MeshClientDeepLinkHost />);
      const uri = `meshcore://channel/add?name=Public&secret=${MC_SECRET}`;
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
      // No MeshcoreChannelSection consumer → deferred / queued-for-review toast; pending kept.
      expect(addToast).toHaveBeenCalledWith('qrIngest.meshcoreChannelImported', 'success');
      expect(
        screen.getByRole('button', { name: 'qrIngest.confirmMeshcoreChannelImportAction' }),
      ).toBeTruthy();
    } finally {
      window.removeEventListener('mesh-client:meshcoreChannelFromQr', spy as EventListener);
    }
  });

  it('cancel does not import', async () => {
    const user = userEvent.setup();
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(`lxma://${LXMA_DEST}:${LXMA_PUB}`);
      await Promise.resolve();
    });
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    expect(registerReticulumKnownIdentity).not.toHaveBeenCalled();
    expect(window.electronAPI.db.upsertReticulumDestination).not.toHaveBeenCalled();
  });

  it('ingests encrypted paper links via sidecar', async () => {
    const paperUri = `lxm://${'A'.repeat(48)}`;
    const proxyPost = vi.fn().mockResolvedValue({ ok: true });
    window.electronAPI.reticulum = {
      ...window.electronAPI.reticulum,
      proxyPost,
    };
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(paperUri);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/paper/ingest', { uri: paperUri });
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.paperIngested', 'success');
  });

  it('toasts decrypt failure for paper ingest', async () => {
    const paperUri = `lxm://${'B'.repeat(48)}`;
    const proxyPost = vi.fn().mockResolvedValue({ ok: false, error: 'decrypt_failed' });
    window.electronAPI.reticulum = {
      ...window.electronAPI.reticulum,
      proxyPost,
    };
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(paperUri);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('qrIngest.paperDecryptFailed', 'error');
    });
  });

  it('treats non-paper short lxm:// blobs as unknown', async () => {
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.('lxm://paper/not-a-supported-form');
      await Promise.resolve();
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.unknownLink', 'error');
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

  it('dispatches Games session deep links without confirm', async () => {
    const sessionId = 'a'.repeat(16);
    const spy = vi.fn();
    window.addEventListener('mesh-client:openGamesSession', spy as EventListener);
    render(<MeshClientDeepLinkHost />);
    await act(async () => {
      openUrlHandler?.(`lrgp:${sessionId}`);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalled();
    const detail = (spy.mock.calls[0]?.[0] as CustomEvent<{ sessionId: string }>).detail;
    expect(detail.sessionId).toBe(sessionId);
    expect(addToast).not.toHaveBeenCalledWith('qrIngest.unknownLink', 'error');
    window.removeEventListener('mesh-client:openGamesSession', spy as EventListener);
  });
});
