import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { GameSession } from '@/shared/games-types';

import { ChessBoard } from './ChessBoard';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'chess',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
    initiator: 'me',
    status: 'active',
    metadata: {
      fen: STARTING_FEN,
      moves: [],
      my_color: 'w',
      first_turn: 'me',
      turn: 'me',
      move_count: 0,
      winner: '',
      terminal: '',
      draw_offered: false,
      in_check: false,
      legal_moves: [],
    },
    unread: 0,
    created_at: 1,
    updated_at: 1,
    last_action_at: 1,
    ...overrides,
  };
}

describe('ChessBoard', () => {
  it('renders the starting position with no axe violations', async () => {
    const { container } = render(<ChessBoard session={makeSession()} onMove={vi.fn()} />);
    hydrateAxeThemeColors(document.documentElement);
    expect(screen.getByRole('group', { name: 'Chess board' })).toBeInTheDocument();
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sends a UCI move via two clicks: select a piece then its destination', async () => {
    const onMove = vi.fn();
    render(<ChessBoard session={makeSession()} onMove={onMove} />);

    // White pawn e2 -> e4 (no legal-move buttons since legal_moves is empty).
    await userEvent.click(screen.getByRole('button', { name: /^e2,/ }));
    await userEvent.click(screen.getByRole('button', { name: /^e4,/ }));

    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('deselects when clicking the same square twice', async () => {
    const onMove = vi.fn();
    render(<ChessBoard session={makeSession()} onMove={onMove} />);

    const e2 = screen.getByRole('button', { name: /^e2,/ });
    await userEvent.click(e2);
    await userEvent.click(e2);

    expect(onMove).not.toHaveBeenCalled();
  });

  it('sends a move from the legal-move quick list', async () => {
    const onMove = vi.fn();
    render(
      <ChessBoard
        session={makeSession({
          metadata: {
            fen: STARTING_FEN,
            moves: [],
            my_color: 'w',
            first_turn: 'me',
            turn: 'me',
            move_count: 0,
            winner: '',
            terminal: '',
            draw_offered: false,
            in_check: false,
            legal_moves: ['e2e4', 'd2d4'],
          },
        })}
        onMove={onMove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Play e2e4' }));

    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('disables the board when it is not my turn and shows opponent turn text', () => {
    render(
      <ChessBoard
        session={makeSession({
          metadata: {
            fen: STARTING_FEN,
            moves: [],
            my_color: 'w',
            first_turn: 'me',
            turn: 'opponent',
            move_count: 0,
            winner: '',
            terminal: '',
            draw_offered: false,
            in_check: false,
            legal_moves: [],
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^e2,/ })).toBeDisabled();
  });

  it('shows in-check status text on my turn', () => {
    render(
      <ChessBoard
        session={makeSession({
          metadata: {
            fen: STARTING_FEN,
            moves: [],
            my_color: 'w',
            first_turn: 'me',
            turn: 'me',
            move_count: 0,
            winner: '',
            terminal: '',
            draw_offered: false,
            in_check: true,
            legal_moves: [],
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('Your turn — you are in check')).toBeInTheDocument();
  });
});
