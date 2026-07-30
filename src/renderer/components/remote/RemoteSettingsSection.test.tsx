// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteSettingsSection } from '@/renderer/components/remote/RemoteSettingsSection';
import { DEFAULT_REMOTE_SETTINGS } from '@/renderer/lib/remoteSettingsStorage';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

describe('RemoteSettingsSection inbound apply', () => {
  const onSettingsChange = vi.fn();

  beforeEach(() => {
    onSettingsChange.mockReset();
    useRncpTransferStore.getState().clearAll();
    useReticulumInboundPolicyStore.setState({ policies: new Map(), loading: false });
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).mockReset();
    vi.mocked(window.electronAPI.reticulum.remote.getIdentity).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: false,
      inbound_mode: 'off',
      allowed: [],
      blocked: [],
    });
    vi.mocked(window.electronAPI.reticulum.remote.getIdentity).mockResolvedValue({
      identity_hash: null,
      rncp_receive_hash: null,
    });
  });

  it('re-picks save dir when persisted path is rejected, then enables without optimistic Ask', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.reticulum.rncp.setListener)
      .mockResolvedValueOnce({ ok: false, error: 'save_dir_not_from_picker' })
      .mockResolvedValueOnce({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).mockResolvedValue({
      canceled: false,
      path: '/tmp/rncp-inbox-picked',
    });
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
        destination_hash: 'a'.repeat(32),
        allowed: [],
        blocked: [],
      });

    render(
      <RemoteSettingsSection
        sidecarRunning
        settings={{
          ...DEFAULT_REMOTE_SETTINGS,
          inboundMode: 'off',
          lastSaveDir: '/Users/joey/Downloads',
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.setListener).toHaveBeenCalledTimes(2);
    });
    // Must not persist Ask until setListener succeeds (first call failed).
    const askPatches = onSettingsChange.mock.calls.filter(
      (c) => (c[0] as { inboundMode?: string }).inboundMode === 'ask',
    );
    expect(askPatches.length).toBeGreaterThanOrEqual(1);
    expect(askPatches[0]?.[0]).toEqual(
      expect.objectContaining({
        inboundMode: 'ask',
        lastSaveDir: '/tmp/rncp-inbox-picked',
      }),
    );
    expect(useRncpTransferStore.getState().listener?.inbound_mode).toBe('ask');
  });

  it('does not persist Ask when setListener fails and user cancels re-pick', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.reticulum.rncp.setListener).mockResolvedValue({
      ok: false,
      error: 'save_dir_not_from_picker',
    });
    vi.mocked(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).mockResolvedValue({
      canceled: true,
      path: null,
    });

    render(
      <RemoteSettingsSection
        sidecarRunning
        settings={{
          ...DEFAULT_REMOTE_SETTINGS,
          inboundMode: 'off',
          lastSaveDir: '/Users/joey/Downloads',
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.showSaveDirectoryDialog).toHaveBeenCalled();
    });
    expect(
      onSettingsChange.mock.calls.some(
        (c) => (c[0] as { inboundMode?: string }).inboundMode === 'ask',
      ),
    ).toBe(false);
  });

  it('announces receive destination when listener is enabled', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.reticulum.rncp.getListener).mockResolvedValue({
      enabled: true,
      inbound_mode: 'ask',
      destination_hash: 'a'.repeat(32),
      allowed: [],
      blocked: [],
    });
    vi.mocked(window.electronAPI.reticulum.rncp.announce).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.announce).mockResolvedValue({ ok: true });
    useRncpTransferStore.getState().setListener({
      enabled: true,
      inbound_mode: 'ask',
      destination_hash: 'a'.repeat(32),
      allowed: [],
      blocked: [],
    });

    render(
      <RemoteSettingsSection
        sidecarRunning
        settings={{
          ...DEFAULT_REMOTE_SETTINGS,
          inboundMode: 'ask',
          lastSaveDir: '/tmp/rncp-inbox',
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    const btn = await screen.findByRole('button', { name: /Announce rncp receive destination/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.announce).toHaveBeenCalled();
    });
  });
});
