// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ReticulumPeerDetailErrorBoundary } from './ReticulumPeerDetailErrorBoundary';

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

function ThrowingPeerModal({ peerHash }: { peerHash: string }): ReactElement {
  if (peerHash === 'boom') {
    throw new Error('peer detail boom');
  }
  return <div>Peer {peerHash}</div>;
}

describe('ReticulumPeerDetailErrorBoundary', () => {
  it('shows fallback on throw, Close clears selection, and another peer can open', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function Host() {
      const [selectedPeerHash, setSelectedPeerHash] = useState<string | null>('boom');
      if (selectedPeerHash === null) {
        return <div>No peer selected</div>;
      }
      return (
        <ReticulumPeerDetailErrorBoundary
          peerHash={selectedPeerHash}
          onClose={() => {
            setSelectedPeerHash(null);
          }}
          suspenseFallback={<div>Loading…</div>}
        >
          <ThrowingPeerModal peerHash={selectedPeerHash} />
        </ReticulumPeerDetailErrorBoundary>
      );
    }

    const { rerender } = render(<Host />);
    expect(screen.getByRole('alert')).toHaveTextContent('peer detail boom');

    await user.click(screen.getByRole('button', { name: 'aria.closeDialog' }));
    expect(screen.getByText('No peer selected')).toBeInTheDocument();

    // Remount host with a healthy peer after close.
    function HealthyHost() {
      return (
        <ReticulumPeerDetailErrorBoundary
          peerHash="safepeer"
          onClose={() => {}}
          suspenseFallback={<div>Loading…</div>}
        >
          <ThrowingPeerModal peerHash="safepeer" />
        </ReticulumPeerDetailErrorBoundary>
      );
    }
    rerender(<HealthyHost />);
    await waitFor(() => {
      expect(screen.getByText('Peer safepeer')).toBeInTheDocument();
    });
  });

  it('resets error state when peerHash changes (resetKeys)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Switchable() {
      const [hash, setHash] = useState('boom');
      return (
        <div>
          <button
            type="button"
            aria-label="Switch peer"
            onClick={() => {
              setHash('safepeer');
            }}
          >
            Switch
          </button>
          <ReticulumPeerDetailErrorBoundary
            peerHash={hash}
            onClose={() => {}}
            suspenseFallback={<div>Loading…</div>}
          >
            <ThrowingPeerModal peerHash={hash} />
          </ReticulumPeerDetailErrorBoundary>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<Switchable />);
    expect(screen.getByRole('alert')).toHaveTextContent('peer detail boom');
    await user.click(screen.getByRole('button', { name: 'Switch peer' }));
    await waitFor(() => {
      expect(screen.getByText('Peer safepeer')).toBeInTheDocument();
    });
  });
});
