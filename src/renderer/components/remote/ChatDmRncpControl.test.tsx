import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

import { ChatDmRncpControl } from './ChatDmRncpControl';

const PEER_HASH = 'a'.repeat(32);
const PEER_IDENTITY = 'd'.repeat(32);

describe('ChatDmRncpControl', () => {
  beforeEach(() => {
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
});
