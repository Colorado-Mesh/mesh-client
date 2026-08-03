import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureRncpDestinationReachable } from '@/renderer/lib/ensureRncpDestinationReachable';
import { sendRncpRequestEnable } from '@/renderer/lib/sendRncpRequestEnable';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

import { ChatDmRncpControl } from './ChatDmRncpControl';

vi.mock('@/renderer/lib/ensureRncpDestinationReachable', () => ({
  ensureRncpDestinationReachable: vi.fn(),
}));

vi.mock('@/renderer/lib/sendRncpRequestEnable', () => ({
  sendRncpRequestEnable: vi.fn(),
}));

const addToast = vi.fn();

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

const PEER_HASH = 'a'.repeat(32);
const PEER_IDENTITY = 'd'.repeat(32);
const DEST_HASH = 'c'.repeat(32);

function seedSavedRncpAddress(): void {
  useReticulumRemoteAddressStore.setState({
    addresses: new Map([
      [
        'addr1',
        {
          id: 'addr1',
          label: 'Alice',
          service: 'rncp',
          destination_hash: DEST_HASH,
          lxmf_peer_hash: PEER_HASH,
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]),
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
}

describe('ChatDmRncpControl', () => {
  beforeEach(() => {
    addToast.mockReset();
    vi.mocked(ensureRncpDestinationReachable).mockReset();
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'reachable', hops: 1 });
    vi.mocked(sendRncpRequestEnable).mockReset();
    vi.mocked(sendRncpRequestEnable).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.rncp.showOpenFileDialog).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.showOpenFileDialog).mockResolvedValue({
      canceled: true,
      path: null,
    });
    vi.mocked(window.electronAPI.reticulum.rncp.send).mockReset();
    useRncpTransferStore.getState().clearAll();
    useReticulumRemoteAddressStore.setState({
      addresses: new Map(),
      hydrated: false,
      hydrate: () => {
        useReticulumRemoteAddressStore.setState({ hydrated: true });
        return Promise.resolve();
      },
    });
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          PEER_HASH,
          [
            {
              destination_hash: PEER_HASH,
              aspect: 'lxmf.delivery',
              identity_hash: PEER_IDENTITY,
              last_seen: Date.now(),
            },
          ],
        ],
      ]),
    });
  });

  it('renders a Send file button gated to the open DM peer', () => {
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    expect(screen.getByRole('button', { name: 'Send file to Alice via rncp' })).toBeInTheDocument();
  });

  it('styles Send file as a cyan text-link, not a bordered box', () => {
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    const trigger = screen.getByRole('button', { name: 'Send file to Alice via rncp' });
    expect(trigger.className).toContain('text-cyan-400');
    expect(trigger.className).toContain('hover:underline');
    expect(trigger.className).not.toMatch(/border-gray-700\/60/);
    expect(trigger.className).not.toMatch(/bg-gray-800\/40/);
  });

  it('shows a pending-offer badge only for offers from this peer', () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't1',
      file_name: 'a.txt',
      bytes: 10,
      identity_hash: PEER_IDENTITY,
    });
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't2',
      file_name: 'b.txt',
      bytes: 20,
      identity_hash: 'b'.repeat(32),
    });
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('counts active peer transfers outside the newest five displayed rows', () => {
    const destinationHash = 'c'.repeat(32);
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Alice',
            service: 'rncp',
            destination_hash: destinationHash,
            lxmf_peer_hash: PEER_HASH,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    for (let i = 0; i < 6; i += 1) {
      useRncpTransferStore.getState().startTransfer({
        transfer_id: `transfer-${i}`,
        kind: 'send',
        destination_hash: destinationHash,
        file_name: `${i}.txt`,
      });
    }

    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);

    expect(screen.getByLabelText('6 active file transfers with this peer')).toBeInTheDocument();
  });

  it('opens the send panel and pre-fills the destination hash from a saved address', async () => {
    useReticulumRemoteAddressStore.setState({
      addresses: new Map([
        [
          'addr1',
          {
            id: 'addr1',
            label: 'Alice',
            service: 'rncp',
            destination_hash: 'c'.repeat(32),
            lxmf_peer_hash: PEER_HASH,
            created_at: 1,
            updated_at: 1,
          },
        ],
      ]),
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    expect(screen.getByLabelText('rncp destination hash')).toHaveValue('c'.repeat(32));
  });

  it('hydrates remote addresses on mount so Chat can see saved peer dests', async () => {
    let hydrated = false;
    useReticulumRemoteAddressStore.setState({
      addresses: new Map(),
      hydrated: false,
      hydrate: () => {
        hydrated = true;
        useReticulumRemoteAddressStore.setState({
          addresses: new Map([
            [
              'addr1',
              {
                id: 'addr1',
                label: 'Alice',
                service: 'rncp',
                destination_hash: 'c'.repeat(32),
                lxmf_peer_hash: PEER_HASH,
                created_at: 1,
                updated_at: 1,
              },
            ],
          ]),
          hydrated: true,
        });
        return Promise.resolve();
      },
    });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await waitFor(() => {
      expect(hydrated).toBe(true);
    });
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    expect(screen.getByLabelText('rncp destination hash')).toHaveValue('c'.repeat(32));
  });

  it('disables the trigger button when the sidecar is not running', () => {
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning={false} />);
    expect(screen.getByRole('button', { name: 'Send file to Alice via rncp' })).toBeDisabled();
  });

  it('accepts a pending offer from this peer and removes it from the list', async () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't1',
      file_name: 'a.txt',
      bytes: 10,
      identity_hash: PEER_IDENTITY,
    });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    await user.click(screen.getByRole('button', { name: 'Accept a.txt' }));
    expect(window.electronAPI.reticulum.rncp.accept).toHaveBeenCalledWith({ transfer_id: 't1' });
    expect(useRncpTransferStore.getState().pendingOffers.size).toBe(0);
  });

  it('hard-blocks send when the receive dest is peerUnreachable', async () => {
    seedSavedRncpAddress();
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'peerUnreachable' });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    await waitFor(() => {
      expect(ensureRncpDestinationReachable).toHaveBeenCalledWith({
        destinationHash: DEST_HASH,
        lxmfPeerHash: PEER_HASH,
      });
    });
    expect(window.electronAPI.reticulum.rncp.showOpenFileDialog).not.toHaveBeenCalled();
    expect(window.electronAPI.reticulum.rncp.send).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      'No path to that destination. The peer may be offline.',
      'error',
    );
  });

  it('opens enable-request confirm when listenerLikelyOff and confirm sends the request', async () => {
    seedSavedRncpAddress();
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'listenerLikelyOff' });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    expect(await screen.findByText('File receiving may be off')).toBeInTheDocument();
    expect(window.electronAPI.reticulum.rncp.showOpenFileDialog).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send enable request' }));
    await waitFor(() => {
      expect(sendRncpRequestEnable).toHaveBeenCalledWith(PEER_HASH);
    });
  });

  it('proceeds to the file picker when the receive dest is reachable', async () => {
    seedSavedRncpAddress();
    vi.mocked(ensureRncpDestinationReachable).mockResolvedValue({ status: 'reachable', hops: 2 });
    vi.mocked(window.electronAPI.reticulum.rncp.showOpenFileDialog).mockResolvedValue({
      canceled: false,
      path: '/tmp/hello.txt',
    });
    vi.mocked(window.electronAPI.reticulum.rncp.send).mockResolvedValue({
      ok: true,
      transfer_id: 'xfer-1',
    });
    const user = userEvent.setup();
    render(<ChatDmRncpControl lxmfPeerHash={PEER_HASH} peerLabel="Alice" sidecarRunning />);
    await user.click(screen.getByRole('button', { name: 'Send file to Alice via rncp' }));
    await user.click(screen.getByRole('button', { name: 'Send file' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.rncp.send).toHaveBeenCalledWith({
        destination_hash: DEST_HASH,
        path: '/tmp/hello.txt',
      });
    });
  });
});
