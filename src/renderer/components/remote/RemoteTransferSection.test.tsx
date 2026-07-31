// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTransferSection } from '@/renderer/components/remote/RemoteTransferSection';
import { ensureRncpDestinationReachable } from '@/renderer/lib/ensureRncpDestinationReachable';
import { DEFAULT_REMOTE_SETTINGS } from '@/renderer/lib/remoteSettingsStorage';
import { sendRncpRequestEnable } from '@/renderer/lib/sendRncpRequestEnable';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

const addToast = vi.fn();

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('@/renderer/lib/ensureRncpDestinationReachable', () => ({
  ensureRncpDestinationReachable: vi.fn(),
  isRncpHexHash: (value: string) => /^[0-9a-f]{32}$/.test(value),
}));

vi.mock('@/renderer/lib/sendRncpRequestEnable', () => ({
  sendRncpRequestEnable: vi.fn(),
}));

vi.mock('@/renderer/hooks/useRemotePathCapability', () => ({
  useRemotePathCapability: () => ({
    capability: {
      destination_hash: 'c'.repeat(32),
      speed: 'high',
      via_atoms: ['tcp'],
      transfer_allowed: true,
      shell_allowed: true,
    },
    loading: false,
  }),
}));

const DEST_HASH = 'c'.repeat(32);
const LXMF_HASH = 'e'.repeat(32);

describe('RemoteTransferSection', () => {
  beforeEach(() => {
    addToast.mockReset();
    vi.mocked(ensureRncpDestinationReachable).mockReset();
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'reachable', hops: 1 });
    vi.mocked(sendRncpRequestEnable).mockReset();
    vi.mocked(sendRncpRequestEnable).mockResolvedValue({ ok: true });
    useRncpTransferStore.getState().clearAll();
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Peer',
            service: 'rncp',
            destination_hash: DEST_HASH,
            lxmf_peer_hash: LXMF_HASH,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
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
    vi.mocked(window.electronAPI.reticulum.rncp.showOpenFileDialog).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.showOpenFileDialog).mockResolvedValue({
      canceled: false,
      path: '/tmp/notes.txt',
    });
    vi.mocked(window.electronAPI.reticulum.rncp.send).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.send).mockResolvedValue({
      ok: true,
      transfer_id: 'xfer-remote-1',
    });
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

  async function prepareSendForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);
    await user.type(screen.getByLabelText('rncp destination hash'), DEST_HASH);
    await user.click(screen.getByRole('button', { name: 'Choose a local file to send' }));
    await waitFor(() => {
      expect(screen.getByText('/tmp/notes.txt')).toBeInTheDocument();
    });
  }

  async function prepareFetchForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);
    await user.click(screen.getByRole('button', { name: 'Switch to fetch mode' }));
    await user.type(screen.getByLabelText('rncp destination hash'), DEST_HASH);
    await user.type(screen.getByLabelText('Remote file path to fetch'), '/remote/file.bin');
  }

  it('hard-blocks send when peerUnreachable', async () => {
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'peerUnreachable' });
    const user = userEvent.setup();
    await prepareSendForm(user);
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    await waitFor(() => {
      expect(ensureRncpDestinationReachable).toHaveBeenCalledWith({
        destinationHash: DEST_HASH,
        lxmfPeerHash: LXMF_HASH,
      });
    });
    expect(window.electronAPI.reticulum.rncp.send).not.toHaveBeenCalled();
    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'No path to that destination. The peer may be offline.',
      'error',
    );
  });

  it('hard-blocks fetch when peerUnreachable', async () => {
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'peerUnreachable' });
    vi.mocked(window.electronAPI.reticulum.rncp.fetch).mockReset();
    const user = userEvent.setup();
    await prepareFetchForm(user);
    await user.click(screen.getByRole('button', { name: 'Fetch file' }));

    await waitFor(() => {
      expect(ensureRncpDestinationReachable).toHaveBeenCalledWith({
        destinationHash: DEST_HASH,
        lxmfPeerHash: LXMF_HASH,
      });
    });
    expect(window.electronAPI.reticulum.rncp.fetch).not.toHaveBeenCalled();
    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
  });

  it('hard-blocks retry when unreachable without enable-request or IPC', async () => {
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'peerUnreachable' });
    useRncpTransferStore.getState().startTransfer({
      transfer_id: 'failed-1',
      kind: 'send',
      destination_hash: DEST_HASH,
      file_name: 'notes.txt',
      retryArgs: { path: '/tmp/notes.txt' },
    });
    useRncpTransferStore.getState().applyFailed({
      transfer_id: 'failed-1',
      file_name: 'notes.txt',
      error: 'timeout',
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: 'Retry transfer of notes.txt' }));

    await waitFor(() => {
      expect(ensureRncpDestinationReachable).toHaveBeenCalledWith({
        destinationHash: DEST_HASH,
        lxmfPeerHash: LXMF_HASH,
      });
    });
    expect(window.electronAPI.reticulum.rncp.send).not.toHaveBeenCalled();
    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
    expect(useRncpTransferStore.getState().transfers.get('failed-1')?.retryCount).toBe(0);
  });

  it('opens enable-request confirm on listenerLikelyOff and confirm sends the request', async () => {
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'listenerLikelyOff' });
    const user = userEvent.setup();
    await prepareSendForm(user);
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    expect(await screen.findByText('File receiving may be off')).toBeInTheDocument();
    expect(window.electronAPI.reticulum.rncp.send).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send enable request' }));
    await waitFor(() => {
      expect(sendRncpRequestEnable).toHaveBeenCalledWith(LXMF_HASH);
    });
  });

  it('retry on listenerLikelyOff does not open enable-request or call IPC', async () => {
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'listenerLikelyOff' });
    useRncpTransferStore.getState().startTransfer({
      transfer_id: 'failed-2',
      kind: 'send',
      destination_hash: DEST_HASH,
      file_name: 'notes.txt',
      retryArgs: { path: '/tmp/notes.txt' },
    });
    useRncpTransferStore.getState().applyFailed({
      transfer_id: 'failed-2',
      file_name: 'notes.txt',
      error: 'timeout',
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: 'Retry transfer of notes.txt' }));

    await waitFor(() => {
      expect(ensureRncpDestinationReachable).toHaveBeenCalled();
    });
    expect(screen.queryByText('File receiving may be off')).not.toBeInTheDocument();
    expect(window.electronAPI.reticulum.rncp.send).not.toHaveBeenCalled();
    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
    expect(useRncpTransferStore.getState().transfers.get('failed-2')?.retryCount).toBe(0);
    expect(addToast).toHaveBeenCalledWith(
      'No path to their file receive destination; file receiving may be off. Send an enable request, then try again.',
      'error',
    );
  });

  it('sends when the receive dest is reachable', async () => {
    const user = userEvent.setup();
    await prepareSendForm(user);
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.send).toHaveBeenCalledWith({
        destination_hash: DEST_HASH,
        path: '/tmp/notes.txt',
      });
    });
  });

  it('rejects request-enable when saved LXMF hash is missing', async () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Peer',
            service: 'rncp',
            destination_hash: DEST_HASH,
            lxmf_peer_hash: null,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);
    await user.type(screen.getByLabelText('rncp destination hash'), DEST_HASH);
    await user.click(
      screen.getByRole('button', { name: 'Request that this peer enable file receiving' }),
    );

    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'Enter a valid 32-character hex destination hash.',
      'error',
    );
  });

  it('rejects request-enable when saved LXMF hash equals the rncp dest', async () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Peer',
            service: 'rncp',
            destination_hash: DEST_HASH,
            lxmf_peer_hash: DEST_HASH,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);
    await user.type(screen.getByLabelText('rncp destination hash'), DEST_HASH);
    await user.click(
      screen.getByRole('button', { name: 'Request that this peer enable file receiving' }),
    );

    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'Enter a valid 32-character hex destination hash.',
      'error',
    );
  });

  it('rejects request-enable when saved LXMF hash is invalid', async () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Peer',
            service: 'rncp',
            destination_hash: DEST_HASH,
            lxmf_peer_hash: 'not-a-hash',
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    const user = userEvent.setup();
    render(<RemoteTransferSection sidecarRunning settings={DEFAULT_REMOTE_SETTINGS} />);
    await user.type(screen.getByLabelText('rncp destination hash'), DEST_HASH);
    await user.click(
      screen.getByRole('button', { name: 'Request that this peer enable file receiving' }),
    );

    expect(sendRncpRequestEnable).not.toHaveBeenCalled();
  });
});
