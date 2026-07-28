// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRncpEnableRequestStore } from '@/renderer/stores/rncpEnableRequestStore';

import { RncpEnableRequestModal } from './RncpEnableRequestModal';

const addToast = vi.fn();

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

describe('RncpEnableRequestModal', () => {
  beforeEach(() => {
    addToast.mockReset();
    useRncpEnableRequestStore.getState().clear();
    useRncpEnableRequestStore.getState().enqueue({
      peerHash: 'a'.repeat(32),
      peerLabel: 'Alice',
      receivedAt: Date.now(),
    });
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
});
