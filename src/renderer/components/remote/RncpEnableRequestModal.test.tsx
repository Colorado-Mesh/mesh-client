// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRncpLxmfControlSideEffectDedupForTests } from '@/renderer/lib/rncpLxmfControlSideEffectDedup';
import { useRncpEnableRequestStore } from '@/renderer/stores/rncpEnableRequestStore';
import { RNCP_RECEIVE_DEST_SHARE_PREFIX } from '@/shared/rncpRequestEnable';

import { RncpEnableRequestModal } from './RncpEnableRequestModal';

const addToast = vi.fn();

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  probeReticulumPeer: vi.fn().mockResolvedValue({ ok: false }),
}));

describe('RncpEnableRequestModal', () => {
  beforeEach(() => {
    addToast.mockReset();
    resetRncpLxmfControlSideEffectDedupForTests();
    useRncpEnableRequestStore.setState({ prompts: [], dismissedPeers: new Set() });
    useRncpEnableRequestStore.getState().enqueue({
      peerHash: 'a'.repeat(32),
      peerLabel: 'Alice',
      receivedAt: Date.now(),
    });
    vi.mocked(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).mockResolvedValue({
      canceled: false,
      path: '/tmp/rncp-inbox',
    });
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: false,
      inbound_mode: 'off',
      allowed: [],
      blocked: [],
    });
    vi.mocked(window.electronAPI.reticulum.remote.getIdentity).mockResolvedValue({
      identity_hash: 'b'.repeat(32),
      rncp_receive_hash: 'c'.repeat(32),
    });
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({ ok: true });
  });

  it('renders the enable-request dialog for a queued peer', () => {
    render(<RncpEnableRequestModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Alice/i)).toBeInTheDocument();
  });

  it('dismisses the prompt when Not now is clicked', async () => {
    const user = userEvent.setup();
    render(<RncpEnableRequestModal />);
    await user.click(screen.getByRole('button', { name: 'Dismiss enable request' }));
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
  });

  it('permanently dismisses when Do not ask again is clicked', async () => {
    const user = userEvent.setup();
    render(<RncpEnableRequestModal />);
    await user.click(
      screen.getByRole('button', { name: 'Permanently dismiss enable requests from this peer' }),
    );
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
    expect(useRncpEnableRequestStore.getState().dismissedPeers.has('a'.repeat(32))).toBe(true);
  });

  it('shares rncp receive dest via LXMF after enable', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.getListener)
      .mockResolvedValueOnce({
        enabled: false,
        inbound_mode: 'off',
        allowed: [],
        blocked: [],
      })
      .mockResolvedValue({
        enabled: true,
        inbound_mode: 'ask',
        allowed: [],
        blocked: [],
      });
    const user = userEvent.setup();
    render(<RncpEnableRequestModal />);
    await user.click(
      screen.getByRole('button', { name: 'Enable inbound file offers and ask before accepting' }),
    );
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
        destination_hash: 'a'.repeat(32),
        text: expect.stringContaining(`${RNCP_RECEIVE_DEST_SHARE_PREFIX}${'c'.repeat(32)}`),
      });
    });
  });

  it('auto-shares receive dest when listener is already enabled', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: true,
      inbound_mode: 'ask',
      allowed: [],
      blocked: [],
    });
    render(<RncpEnableRequestModal />);
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
        destination_hash: 'a'.repeat(32),
        text: expect.stringContaining(`${RNCP_RECEIVE_DEST_SHARE_PREFIX}${'c'.repeat(32)}`),
      });
    });
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
  });

  it('auto-dismisses a repeat enable-request while already listening without re-sharing', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: true,
      inbound_mode: 'ask',
      allowed: [],
      blocked: [],
    });
    const { rerender } = render(<RncpEnableRequestModal />);
    await waitFor(() => {
      expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
    });
    expect(vi.mocked(window.electronAPI.reticulum.proxyPost)).toHaveBeenCalledTimes(1);

    useRncpEnableRequestStore.getState().enqueue({
      peerHash: 'a'.repeat(32),
      peerLabel: 'Alice',
      receivedAt: Date.now(),
    });
    rerender(<RncpEnableRequestModal />);
    await waitFor(() => {
      expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
    });
    // Cooldown: second already-enabled pass dismisses only — no duplicate dest-share LXMF.
    expect(vi.mocked(window.electronAPI.reticulum.proxyPost)).toHaveBeenCalledTimes(1);
  });

  it('enables Ask and still shares when Always allow cannot resolve identity', async () => {
    vi.mocked(window.electronAPI.reticulum.rncp.getListener)
      .mockResolvedValueOnce({
        enabled: false,
        inbound_mode: 'off',
        allowed: [],
        blocked: [],
      })
      .mockResolvedValue({
        enabled: true,
        inbound_mode: 'ask',
        allowed: [],
        blocked: [],
      });
    const user = userEvent.setup();
    render(<RncpEnableRequestModal />);
    await user.click(
      screen.getByRole('button', {
        name: 'Enable inbound file offers and allow this sender',
      }),
    );
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('File receiving is enabled.', 'success');
    });
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('identity hash is not known yet'),
      'info',
    );
    await waitFor(() => {
      expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
        destination_hash: 'a'.repeat(32),
        text: expect.stringContaining(`${RNCP_RECEIVE_DEST_SHARE_PREFIX}${'c'.repeat(32)}`),
      });
    });
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(0);
  });
});
