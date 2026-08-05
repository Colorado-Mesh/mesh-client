import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import type { GameSession } from '@/shared/games-types';

import GamesPanel from './GamesPanel';

const peerHash = 'a'.repeat(32);

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: peerHash,
    initiator: 'me',
    status: 'active',
    metadata: {
      board: '_________',
      turn: 'me',
      first_turn: 'me',
      my_marker: 'X',
      move_count: 0,
      winner: '',
      terminal: '',
      draw_offered: false,
    },
    unread: 0,
    created_at: 1,
    updated_at: 1,
    last_action_at: 1,
    ...overrides,
  };
}

async function renderAndSelectSession(session: GameSession) {
  vi.mocked(window.electronAPI.reticulum.games.listSessions).mockResolvedValue({
    sessions: [session],
  });
  render(<GamesPanel isActive />);
  const row = await screen.findByRole('button', { name: new RegExp(`game with`, 'i') });
  await userEvent.click(row);
}

describe('GamesPanel', () => {
  beforeEach(() => {
    useReticulumGamesStore.getState().clear();
    hydrateAxeThemeColors(document.documentElement);
    vi.mocked(window.electronAPI.reticulum.games.getStatus).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.getStatus).mockResolvedValue({
      available: true,
      enabled: true,
      running: true,
    });
    vi.mocked(window.electronAPI.reticulum.games.listApps).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.listApps).mockResolvedValue({ apps: [] });
    vi.mocked(window.electronAPI.reticulum.games.listSessions).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.listSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.games.markRead).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.markRead).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.games.resend).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.resend).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.reticulum.games.deleteSession).mockClear();
    vi.mocked(window.electronAPI.reticulum.games.deleteSession).mockResolvedValue({ ok: true });
  });

  it('renders the empty state with no axe violations', async () => {
    const { container } = render(<GamesPanel isActive />);
    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.listSessions).toHaveBeenCalled();
    });
    expect(screen.getByText('No game sessions yet.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lists sessions and shows the selected session board', async () => {
    await renderAndSelectSession(makeSession());

    expect(screen.getByRole('group', { name: 'Tic-Tac-Toe board' })).toBeInTheDocument();
  });

  it('sends a challenge action for a valid peer hash', async () => {
    render(<GamesPanel isActive />);

    const input = screen.getByLabelText('Peer destination hash');
    await userEvent.type(input, peerHash);
    await userEvent.click(screen.getByRole('button', { name: 'Send challenge' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({ dest_hash: peerHash, app_id: 'ttt', command: 'challenge' }),
      );
    });
  });

  it('sends a move via the tic-tac-toe board when clicking a cell', async () => {
    await renderAndSelectSession(makeSession());

    await userEvent.click(screen.getByRole('button', { name: 'Cell 1, empty' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({
          dest_hash: peerHash,
          app_id: 'ttt',
          command: 'move',
          session_id: 's1',
          payload: { i: 0 },
        }),
      );
    });
  });

  it('shows Accept/Decline for a pending session that was not initiated locally', async () => {
    await renderAndSelectSession(makeSession({ status: 'pending', initiator: peerHash }));

    await userEvent.click(screen.getByRole('button', { name: 'Accept challenge' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'accept', session_id: 's1' }),
      );
    });
  });

  it('resigns after confirming the resign modal', async () => {
    await renderAndSelectSession(makeSession({ status: 'active' }));

    await userEvent.click(screen.getByRole('button', { name: 'Resign' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Resign game?' });
    expect(dialog).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resign' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'resign', session_id: 's1' }),
      );
    });
  });

  it('sends draw accept and decline when draw_offered metadata is set', async () => {
    await renderAndSelectSession(
      makeSession({
        metadata: {
          board: '_________',
          turn: 'me',
          first_turn: 'me',
          my_marker: 'X',
          move_count: 0,
          winner: '',
          terminal: '',
          draw_offered: true,
        },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Accept draw offer' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'draw_accept', session_id: 's1' }),
      );
    });

    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Decline draw offer' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'draw_decline', session_id: 's1' }),
      );
    });
  });

  it('shows resend after a failed action and triggers resend', async () => {
    vi.mocked(window.electronAPI.reticulum.games.sendAction).mockResolvedValue({
      ok: false,
      session_id: 's1',
      error: 'send_failed',
    });
    vi.mocked(window.electronAPI.reticulum.games.resend).mockResolvedValue({ ok: true });

    await renderAndSelectSession(makeSession());
    await userEvent.click(screen.getByRole('button', { name: 'Cell 1, empty' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalled();
    });

    // Simulate WS action_result for the failed send so the resend control appears.
    act(() => {
      useReticulumGamesStore.getState().applyActionResult({
        app_id: 'ttt',
        session_id: 's1',
        ok: false,
        error: 'send_failed',
      });
    });

    const resend = await screen.findByRole('button', { name: 'Resend last action' });
    await userEvent.click(resend);

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.resend).toHaveBeenCalledWith('s1');
    });
  });

  it('deletes a session only after confirmation', async () => {
    vi.mocked(window.electronAPI.reticulum.games.deleteSession).mockResolvedValue({ ok: true });
    await renderAndSelectSession(makeSession());

    await userEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete session' }));

    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.deleteSession).toHaveBeenCalledWith('s1');
    });
  });
});
