import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';

import { RrcNickList } from './RrcNickList';

describe('RrcNickList', () => {
  it('collapses and expands the members panel', async () => {
    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();
    const onRefreshWho = vi.fn();
    const onNickClick = vi.fn();
    const members = [
      { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
      { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
    ];

    const { rerender } = render(
      <RrcNickList
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        members={members}
        busy={false}
        onRefreshWho={onRefreshWho}
        onNickClick={onNickClick}
      />,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse members list' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Collapse members list' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <RrcNickList
        collapsed
        onToggleCollapsed={onToggleCollapsed}
        members={members}
        busy={false}
        onRefreshWho={onRefreshWho}
        onNickClick={onNickClick}
      />,
    );

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand members list' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('applies the same nick color class as the transcript helper', () => {
    render(
      <RrcNickList
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        members={[{ identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Zeva' }]}
        busy={false}
        onRefreshWho={vi.fn()}
        onNickClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Zeva').className).toContain(rrcNickColorClass('Zeva'));
  });
});
