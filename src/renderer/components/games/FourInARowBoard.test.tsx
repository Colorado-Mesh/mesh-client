import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { GameSession } from '@/shared/games-types';

import { FourInARowBoard } from './FourInARowBoard';

const EMPTY = '_'.repeat(42);

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'four_in_a_row',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
    initiator: 'me',
    status: 'active',
    metadata: {
      board: EMPTY,
      turn: 'me',
      first_turn: 'me',
      my_marker: 'A',
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

/** Place `marker` at the given row/column on a 42-cell row-major board. */
function boardWith(placements: [number, number, string][]): string {
  const cells = EMPTY.split('');
  for (const [row, column, marker] of placements) {
    cells[row * 7 + column] = marker;
  }
  return cells.join('');
}

describe('FourInARowBoard', () => {
  it('renders an empty board with no axe violations', async () => {
    const { container } = render(<FourInARowBoard session={makeSession()} onMove={vi.fn()} />);
    hydrateAxeThemeColors(document.documentElement);

    expect(screen.getByRole('group', { name: 'Four in a Row board' })).toBeInTheDocument();
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders seven column buttons', () => {
    render(<FourInARowBoard session={makeSession()} onMove={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(7);
  });

  it('calls onMove with the zero-based column index', async () => {
    const onMove = vi.fn();
    render(<FourInARowBoard session={makeSession()} onMove={onMove} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Column 3, bottom to top: empty. Drop here' }),
    );

    expect(onMove).toHaveBeenCalledWith(2);
  });

  it('describes stacked discs bottom-to-top in the column label', () => {
    render(
      <FourInARowBoard
        session={makeSession({
          metadata: {
            // Column 0: 'A' on the bottom row, 'B' directly above it.
            board: boardWith([
              [5, 0, 'A'],
              [4, 0, 'B'],
            ]),
            turn: 'me',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 2,
            winner: '',
            terminal: '',
            draw_offered: false,
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Column 1, bottom to top: A, B. Drop here' }),
    ).toBeEnabled();
  });

  it('disables a full column but leaves others playable', () => {
    render(
      <FourInARowBoard
        session={makeSession({
          metadata: {
            board: boardWith(
              [0, 1, 2, 3, 4, 5].map((row) => [row, 0, 'A'] as [number, number, string]),
            ),
            turn: 'me',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 6,
            winner: '',
            terminal: '',
            draw_offered: false,
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Column 1, bottom to top: A, A, A, A, A, A. Full' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Column 2, bottom to top: empty. Drop here' }),
    ).toBeEnabled();
  });

  it('disables every column when it is not my turn', () => {
    render(
      <FourInARowBoard
        session={makeSession({
          metadata: {
            board: EMPTY,
            turn: 'opponent',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 1,
            winner: '',
            terminal: '',
            draw_offered: false,
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText("Opponent's turn")).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('honors the disabled prop while it is my turn', () => {
    render(<FourInARowBoard session={makeSession()} onMove={vi.fn()} disabled />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('shows the win message on a terminal win', () => {
    render(
      <FourInARowBoard
        session={makeSession({
          status: 'completed',
          metadata: {
            board: boardWith([
              [5, 0, 'A'],
              [5, 1, 'A'],
              [5, 2, 'A'],
              [5, 3, 'A'],
            ]),
            turn: '',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 7,
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

  it('shows the loss message when the opponent won', () => {
    render(
      <FourInARowBoard
        session={makeSession({
          status: 'completed',
          metadata: {
            board: EMPTY,
            turn: '',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 8,
            winner: 'opponent',
            terminal: 'win',
            draw_offered: false,
          },
        })}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByText('Opponent won.')).toBeInTheDocument();
  });

  it('shows the draw-offer banners only while active', () => {
    const { rerender } = render(
      <FourInARowBoard
        session={makeSession({
          metadata: {
            board: EMPTY,
            turn: 'me',
            first_turn: 'me',
            my_marker: 'A',
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

    rerender(
      <FourInARowBoard
        session={makeSession({
          status: 'completed',
          metadata: {
            board: EMPTY,
            turn: '',
            first_turn: 'me',
            my_marker: 'A',
            move_count: 0,
            winner: '',
            terminal: 'draw',
            draw_offered: true,
            draw_offered_by: 'peer',
          },
        })}
        onMove={vi.fn()}
      />,
    );
    expect(screen.queryByText('Your opponent offered a draw.')).not.toBeInTheDocument();
    expect(screen.getByText('Draw.')).toBeInTheDocument();
  });
});
