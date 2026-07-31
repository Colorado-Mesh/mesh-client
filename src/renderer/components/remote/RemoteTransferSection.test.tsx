// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTransferSection } from '@/renderer/components/remote/RemoteTransferSection';
import { DEFAULT_REMOTE_SETTINGS } from '@/renderer/lib/remoteSettingsStorage';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

const addToast = vi.fn();

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

describe('RemoteTransferSection', () => {
  beforeEach(() => {
    addToast.mockReset();
    useRncpTransferStore.getState().clearAll();
    useReticulumRemoteAddressStore.setState({
      addresses: new Map(),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    vi.mocked(window.electronAPI.reticulum.remote.getIdentity).mockReset();
    vi.mocked(window.electronAPI.reticulum.remote.getIdentity).mockResolvedValue({
      identity_hash: 'a'.repeat(32),
      rncp_receive_hash: 'b'.repeat(32),
    });
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockResolvedValue({ ok: true });
  });

  it('smoke-renders transfer controls and loads identity when sidecar is running', async () => {
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);

    expect(screen.getByRole('button', { name: 'Switch to send mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to fetch mode' })).toBeInTheDocument();
    expect(screen.getByText('My identity:')).toBeInTheDocument();

    await waitFor(() => {
      expect(window.electronAPI.reticulum.remote.getIdentity).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('a'.repeat(32))).toBeInTheDocument();
    });
  });

  it('shows pending offers and accepts one via rncp.accept', async () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 'offer-1',
      file_name: 'notes.txt',
      bytes: 42,
      identity_hash: 'c'.repeat(32),
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);

    expect(screen.getByText('Pending inbound files')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept notes.txt' }));

    expect(window.electronAPI.reticulum.rncp.accept).toHaveBeenCalledWith({
      transfer_id: 'offer-1',
    });
    expect(useRncpTransferStore.getState().pendingOffers.size).toBe(0);
  });

  it('rejects a pending offer and removes it even if IPC fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockRejectedValue(new Error('down'));
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 'offer-2',
      file_name: 'photo.png',
      bytes: 100,
      identity_hash: 'd'.repeat(32),
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: 'Reject photo.png' }));
    expect(window.electronAPI.reticulum.rncp.reject).toHaveBeenCalledWith({
      transfer_id: 'offer-2',
    });
    expect(useRncpTransferStore.getState().pendingOffers.size).toBe(0);
  });

  it('does not fetch identity when the sidecar is stopped', async () => {
    render(<RemoteTransferSection sidecarRunning={false} settings={DEFAULT_REMOTE_SETTINGS} />);
    expect(screen.getByText('My identity:')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.reticulum.remote.getIdentity).not.toHaveBeenCalled();
    });
  });
});
