import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { channelButtonLabel, ChatChannelSwitcher } from './ChatChannelSwitcher';

const CHANNELS = [
  { index: 0, name: 'Public' },
  { index: 1, name: 'Ops' },
  { index: 2, name: 'Weather' },
];

function renderSwitcher(onSelect = vi.fn(), activeIndex: number | null = 0) {
  return render(
    <ChatChannelSwitcher
      channels={CHANNELS}
      unreadCounts={
        new Map([
          [0, 4],
          [2, 120],
        ])
      }
      activeIndex={activeIndex}
      onSelect={onSelect}
    />,
  );
}

describe('channelButtonLabel', () => {
  it('appends unread counts, capped at 99+', () => {
    expect(channelButtonLabel('Ops', 0)).toBe('Ops');
    expect(channelButtonLabel('Ops', 3)).toBe('Ops 3');
    expect(channelButtonLabel('Ops', 150)).toBe('Ops 99+');
  });
});

describe('ChatChannelSwitcher', () => {
  it('counts unread outside the open channel on its trigger', () => {
    renderSwitcher();
    expect(
      screen.getByRole('button', { name: 'All channels (3), 99+ unread' }),
    ).toBeInTheDocument();
  });

  it('opens a searchable list, moves with arrows and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { baseElement } = renderSwitcher(onSelect);
    const trigger = screen.getByRole('button', { name: /All channels/ });
    await user.click(trigger);

    const search = screen.getByRole('combobox', { name: 'Find a channel' });
    expect(search).toHaveFocus();
    expect(screen.getByRole('option', { name: 'Public' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Weather 99+' })).toBeInTheDocument();
    hydrateAxeThemeColors(baseElement);
    expect(await axe(screen.getByRole('listbox'))).toHaveNoViolations();

    await user.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Ops' }).id,
    );
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('filters by name and says when nothing matches', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole('button', { name: /All channels/ }));
    await user.type(screen.getByRole('combobox'), 'wea');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No channels match')).toBeInTheDocument();
  });

  it('closes on Escape and on an outside pointer press', async () => {
    const user = userEvent.setup();
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: /All channels/ });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('ChatChannelSwitcher for direct messages', () => {
  const DMS = [
    { index: 0x1a2b3c4d, name: 'Trail Dave' },
    { index: 0x0badf00d, name: 'Ridge Fox' },
    { index: 0x12345678, name: 'Mesa HQ' },
  ];

  it('uses the direct message wording and finds a conversation by name', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ChatChannelSwitcher
        kind="dms"
        channels={DMS}
        unreadCounts={new Map([[0x0badf00d, 2]])}
        activeIndex={0x1a2b3c4d}
        onSelect={onSelect}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'All direct messages (3), 2 unread' });
    await user.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Direct messages' })).toBeInTheDocument();
    // Node numbers are not shown the way channel indexes are.
    expect(screen.queryByText(String(0x0badf00d))).not.toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Find a conversation' }), 'ridge');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(0x0badf00d);
  });
});
