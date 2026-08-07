import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import type { GameSession } from '@/shared/games-types';

import GamesPanel from './GamesPanel';

const peerHash = 'a'.repeat(32);
const peerHashPrefix = peerHash.slice(0, 12);

function seedPeerDisplayName(displayName: string, destinationHash = peerHash) {
  useReticulumPeerStore.setState((s) => ({
    peers: new Map([
      [
        destinationHash,
        {
          destination_hash: destinationHash,
          display_name: displayName,
          hops: 1,
        },
      ],
    ]),
    peersRevision: s.peersRevision + 1,
  }));
}

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
    useReticulumPeerStore.getState().clearPeers();
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

  it('shows the peer display name instead of a hash prefix when known', async () => {
    seedPeerDisplayName('Zeva');
    await renderAndSelectSession(makeSession());

    expect(screen.getByRole('button', { name: /game with Zeva/i })).toBeInTheDocument();
    expect(screen.getByText('Opponent: Zeva')).toBeInTheDocument();
    expect(screen.queryByText(peerHashPrefix)).not.toBeInTheDocument();
    expect(screen.queryByText(peerHash.slice(0, 10))).not.toBeInTheDocument();
  });

  it('falls back to a short hash prefix when the peer is unknown', async () => {
    await renderAndSelectSession(makeSession());

    expect(screen.getByRole('button', { name: /game with aaaaaaaaaaaa/i })).toBeInTheDocument();
    expect(screen.getByText(`Opponent: ${peerHashPrefix}`)).toBeInTheDocument();
  });

  it('updates the opponent label when a peer name arrives later', async () => {
    await renderAndSelectSession(makeSession());
    expect(screen.getByText(`Opponent: ${peerHashPrefix}`)).toBeInTheDocument();

    act(() => {
      seedPeerDisplayName('Zeva');
    });

    expect(await screen.findByText('Opponent: Zeva')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /game with Zeva/i })).toBeInTheDocument();
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

  it('sends draw accept and decline when opponent offered a draw', async () => {
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
          draw_offered_by: peerHash,
        },
      }),
    );

    expect(screen.getByText('Your opponent offered a draw.')).toBeInTheDocument();
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

  it('shows waiting banner and hides Accept when local player offered a draw', async () => {
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
          draw_offered_by: 'me',
        },
      }),
    );

    expect(screen.getByText('Draw offer sent. Waiting for opponent…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept draw offer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline draw offer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Offer draw' })).not.toBeInTheDocument();
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

  it('shows resend when delivery_state is failed', async () => {
    await renderAndSelectSession(makeSession({ delivery_state: 'failed' }));
    expect(screen.getByRole('button', { name: 'Resend last action' })).toBeInTheDocument();
    expect(screen.getByLabelText('Retry needed')).toBeInTheDocument();
  });

  it.each([
    ['pending', 'Sending…'],
    ['sending', 'Sending…'],
    ['propagating', 'Offline Inbox…'],
    ['propagated', 'Stored'],
    ['failed', 'Retry needed'],
  ] as const)('has no axe violations for delivery badge state %s', async (state, label) => {
    const session = makeSession({ delivery_state: state });
    vi.mocked(window.electronAPI.reticulum.games.listSessions).mockResolvedValue({
      sessions: [session],
    });
    const { container } = render(<GamesPanel isActive />);
    const row = await screen.findByRole('button', { name: new RegExp(`game with`, 'i') });
    await userEvent.click(row);
    expect(await screen.findByLabelText(label)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows claim threefold and sends draw_offer with r=3fr', async () => {
    await renderAndSelectSession(
      makeSession({
        app_id: 'chess',
        metadata: {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          turn: 'me',
          my_color: 'w',
          move_count: 0,
          winner: '',
          terminal: '',
          draw_offered: false,
          draw_offer_reason: '3fr',
          in_check: false,
          legal_moves: [],
          moves: [],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Claim threefold repetition draw' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'draw_offer',
          payload: { r: '3fr' },
        }),
      );
    });
  });

  it('shows claim 50-move and sends draw_offer with r=50m', async () => {
    await renderAndSelectSession(
      makeSession({
        app_id: 'chess',
        metadata: {
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          turn: 'me',
          my_color: 'w',
          move_count: 0,
          winner: '',
          terminal: '',
          draw_offered: false,
          draw_offer_reason: '50m',
          in_check: false,
          legal_moves: [],
          moves: [],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Claim fifty-move rule draw' }));
    await waitFor(() => {
      expect(window.electronAPI.reticulum.games.sendAction).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'draw_offer',
          payload: { r: '50m' },
        }),
      );
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
