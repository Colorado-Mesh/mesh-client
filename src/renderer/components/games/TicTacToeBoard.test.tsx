import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { GameSession } from '@/shared/games-types';

import { TicTacToeBoard } from './TicTacToeBoard';

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
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

describe('TicTacToeBoard', () => {
  it('renders an empty board with no axe violations', async () => {
    const { container } = render(<TicTacToeBoard session={makeSession()} onMove={vi.fn()} />);
    hydrateAxeThemeColors(document.documentElement);
    expect(screen.getByRole('group', { name: 'Tic-Tac-Toe board' })).toBeInTheDocument();
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('calls onMove with the cell index when an empty cell is clicked', async () => {
    const onMove = vi.fn();
    render(<TicTacToeBoard session={makeSession()} onMove={onMove} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cell 5, empty' }));

    expect(onMove).toHaveBeenCalledWith(4);
  });

  it('disables occupied cells and does not call onMove', async () => {
    const onMove = vi.fn();
    render(
      <TicTacToeBoard
        session={makeSession({
          metadata: {
            board: 'X________',
            turn: 'me',
            first_turn: 'me',
            my_marker: 'X',
            move_count: 1,
            winner: '',
            terminal: '',
            draw_offered: false,
          },
        })}
        onMove={onMove}
      />,
    );

    const cell1 = screen.getByRole('button', { name: 'Cell 1, X' });
    expect(cell1).toBeDisabled();
    await userEvent.click(cell1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('disables all cells and shows the result when it is not my turn', () => {
    const onMove = vi.fn();
    render(
      <TicTacToeBoard
        session={makeSession({
          metadata: {
            board: 'X________',
            turn: 'opponent',
            first_turn: 'me',
            my_marker: 'X',
            move_count: 1,
            winner: '',
            terminal: '',
            draw_offered: false,
          },
        })}
        onMove={onMove}
      />,
    );

    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cell 2, empty' })).toBeDisabled();
  });

  it('shows the win message and disables the board on terminal win', () => {
    render(
      <TicTacToeBoard
        session={makeSession({
          metadata: {
            board: 'XXX______',
            turn: 'me',
            first_turn: 'me',
            my_marker: 'X',
            move_count: 3,
            winner: 'me',
            terminal: 'win',
            draw_offered: false,
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('You won!')).toBeInTheDocument();
  });

  it('shows the opponent draw-offered banner when peer offered', () => {
    render(
      <TicTacToeBoard
        session={makeSession({
          metadata: {
            board: '_________',
            turn: 'me',
            first_turn: 'me',
            my_marker: 'X',
            move_count: 0,
            winner: '',
            terminal: '',
            draw_offered: true,
            draw_offered_by: 'peer',
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('Your opponent offered a draw.')).toBeInTheDocument();
    expect(screen.queryByText('Draw offer sent. Waiting for opponent…')).not.toBeInTheDocument();
  });

  it('shows the waiting banner when local player offered a draw', () => {
    render(
      <TicTacToeBoard
        session={makeSession({
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
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('Draw offer sent. Waiting for opponent…')).toBeInTheDocument();
    expect(screen.queryByText('Your opponent offered a draw.')).not.toBeInTheDocument();
  });
});
