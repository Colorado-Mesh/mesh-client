import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';

import { ChatDmRncpOfferBanner } from './ChatDmRncpOfferBanner';

const PEER_HASH = 'a'.repeat(32);
const PEER_IDENTITY = 'd'.repeat(32);

describe('ChatDmRncpOfferBanner', () => {
  beforeEach(() => {
    useRncpTransferStore.getState().clearAll();
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
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockResolvedValue({ ok: true });
  });

  it('renders nothing when there are no matching offers', () => {
    const { container } = render(<ChatDmRncpOfferBanner lxmfPeerHash={PEER_HASH} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Accept for pending offers from this peer and accepts via IPC', async () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't1',
      file_name: 'photo.jpg',
      bytes: 100,
      identity_hash: PEER_IDENTITY,
    });
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't2',
      file_name: 'other.txt',
      bytes: 20,
      identity_hash: 'b'.repeat(32),
    });

    const user = userEvent.setup();
    const { container } = render(<ChatDmRncpOfferBanner lxmfPeerHash={PEER_HASH} />);

    expect(screen.getByText('Incoming file offers')).toBeInTheDocument();
    expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    expect(screen.queryByText('other.txt')).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Accept photo.jpg' }));
    expect(window.electronAPI.reticulum.rncp.accept).toHaveBeenCalledWith({ transfer_id: 't1' });
    expect(useRncpTransferStore.getState().pendingOffers.has('t1')).toBe(false);
  });

  it('blocks Reject while Accept is in flight so only one IPC runs', async () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't1',
      file_name: 'photo.jpg',
      bytes: 100,
      identity_hash: PEER_IDENTITY,
    });

    let resolveAccept: ((value: { ok: boolean }) => void) | undefined;
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAccept = resolve;
        }),
    );
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<ChatDmRncpOfferBanner lxmfPeerHash={PEER_HASH} />);

    await user.click(screen.getByRole('button', { name: 'Accept photo.jpg' }));
    await user.click(screen.getByRole('button', { name: 'Reject photo.jpg' }));

    expect(window.electronAPI.reticulum.rncp.accept).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.reticulum.rncp.reject).not.toHaveBeenCalled();

    resolveAccept?.({ ok: true });
    await waitFor(() => {
      expect(useRncpTransferStore.getState().pendingOffers.has('t1')).toBe(false);
    });
  });
});
