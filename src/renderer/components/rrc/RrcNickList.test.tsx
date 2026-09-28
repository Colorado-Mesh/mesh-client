import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';

import { RrcNickList } from './RrcNickList';

const MEMBERS = [
  { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
  { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
];

describe('RrcNickList', () => {
  it('lists members with a count and wires refresh, message and close', async () => {
    const user = userEvent.setup();
    const onRefreshWho = vi.fn();
    const onNickClick = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <RrcNickList
        members={MEMBERS}
        busy={false}
        onRefreshWho={onRefreshWho}
        onNickClick={onNickClick}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Members 2' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh members (/who)' }));
    expect(onRefreshWho).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    expect(onNickClick).toHaveBeenCalledWith(MEMBERS[0]);
    await user.click(screen.getByRole('button', { name: 'Hide members' }));
    expect(onClose).toHaveBeenCalledOnce();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('applies the same nick color class as the transcript helper', () => {
    render(
      <RrcNickList
        members={[{ identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Zeva' }]}
        busy={false}
        onRefreshWho={vi.fn()}
        onNickClick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Zeva').className).toContain(rrcNickColorClass('Zeva'));
  });
});
