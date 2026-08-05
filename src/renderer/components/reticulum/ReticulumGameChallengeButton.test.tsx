// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumGameChallengeButton } from './ReticulumGameChallengeButton';

const peerHash = 'a'.repeat(32);

describe('ReticulumGameChallengeButton', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockResolvedValue({ ok: true });
  });

  it('opens a menu with Tic-Tac-Toe and Chess and has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(<ReticulumGameChallengeButton lxmfPeerHash={peerHash} />);
    hydrateAxeThemeColors(container);
    await user.click(screen.getByRole('button', { name: 'Challenge to a game' }));
    expect(screen.getByRole('button', { name: 'Challenge to Tic-Tac-Toe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Challenge to Chess' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sends a chess challenge action when Chess is picked', async () => {
    const user = userEvent.setup();
    render(<ReticulumGameChallengeButton lxmfPeerHash={peerHash} />);
    await user.click(screen.getByRole('button', { name: 'Challenge to a game' }));
    await user.click(screen.getByRole('button', { name: 'Challenge to Chess' }));

    expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
      expect.objectContaining({ dest_hash: peerHash, app_id: 'chess', command: 'challenge' }),
    );
  });

  it('is disabled when the disabled prop is set', () => {
    render(<ReticulumGameChallengeButton lxmfPeerHash={peerHash} disabled />);
    expect(screen.getByRole('button', { name: 'Challenge to a game' })).toBeDisabled();
  });

  it('does not dispatch a challenge after becoming disabled with the menu open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReticulumGameChallengeButton lxmfPeerHash={peerHash} />);
    await user.click(screen.getByRole('button', { name: 'Challenge to a game' }));
    expect(screen.getByRole('button', { name: 'Challenge to Chess' })).toBeInTheDocument();

    rerender(<ReticulumGameChallengeButton lxmfPeerHash={peerHash} disabled />);
    expect(screen.queryByRole('button', { name: 'Challenge to Chess' })).not.toBeInTheDocument();
    expect(window.electronAPI.reticulum.games.sendAction).not.toHaveBeenCalled();
  });
});
