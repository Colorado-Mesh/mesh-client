import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import Sidebar from './Sidebar';

const defaultProps = {
  collapsed: false,
  onToggle: vi.fn(),
};

describe('Sidebar', () => {
  it('clamps active index above last tab', () => {
    const onChange = vi.fn();
    render(<Sidebar tabs={['A', 'B', 'C']} active={99} onChange={onChange} {...defaultProps} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('clamps negative active index to first tab', () => {
    const onChange = vi.fn();
    render(<Sidebar tabs={['A', 'B', 'C']} active={-1} onChange={onChange} {...defaultProps} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('renders empty tabs array without crashing', () => {
    const onChange = vi.fn();
    render(<Sidebar tabs={[]} active={0} onChange={onChange} {...defaultProps} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('invokes onChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Sidebar tabs={['A', 'B']} active={0} onChange={onChange} {...defaultProps} />);
    await user.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('renders an icon for Sniffer tab', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Sniffer']}
        tabSlotIds={['Sniffer']}
        active={0}
        onChange={onChange}
        {...defaultProps}
      />,
    );
    const tab = screen.getByRole('tab', { name: 'Sniffer' });
    expect(tab.querySelector('svg')).toBeInTheDocument();
  });

  it('renders an icon for Rooms tab', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        {...defaultProps}
      />,
    );
    const tab = screen.getByRole('tab', { name: 'Rooms' });
    expect(tab.querySelector('svg')).toBeInTheDocument();
  });

  it('warns in dev when tabSlotIds length mismatches tabs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat', 'Nodes']}
        tabSlotIds={['Chat']}
        active={0}
        onChange={onChange}
        {...defaultProps}
      />,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('tabSlotIds length (1) does not match tabs length (2)'),
    );
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    warnSpy.mockRestore();
  });

  it('shows tab label when expanded', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat']}
        active={0}
        onChange={onChange}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('hides tab label when collapsed', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat']}
        active={0}
        onChange={onChange}
        collapsed={true}
        onToggle={vi.fn()}
      />,
    );
    // Label span not rendered when collapsed
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
  });

  it('calls onToggle when collapse button is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onChange = vi.fn();
    render(
      <Sidebar tabs={['A']} active={0} onChange={onChange} collapsed={false} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('collapse button label reflects collapsed state', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Sidebar tabs={['A']} active={0} onChange={onChange} collapsed={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();

    rerender(
      <Sidebar tabs={['A']} active={0} onChange={onChange} collapsed={true} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('active tab has aria-selected true', () => {
    const onChange = vi.fn();
    render(<Sidebar tabs={['A', 'B', 'C']} active={1} onChange={onChange} {...defaultProps} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('shows Chat unread badge when chatUnread > 0', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat']}
        active={0}
        onChange={onChange}
        chatUnread={5}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('caps Chat unread badge at 99+', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat']}
        active={0}
        onChange={onChange}
        chatUnread={150}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('has no axe violations when Chat unread badge shows 99+', async () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat']}
        active={0}
        onChange={onChange}
        chatUnread={150}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(await axe(screen.getByText('99+'))).toHaveNoViolations();
  });

  it('shows Rooms unread badge when roomsUnread > 0', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        roomsUnread={3}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rooms 3 unread' })).toBeInTheDocument();
  });

  it('shows RRC unread badge when rrcUnread > 0', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['RRC']}
        tabSlotIds={['RRC']}
        active={0}
        onChange={onChange}
        rrcUnread={7}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'RRC 7 unread' })).toBeInTheDocument();
  });

  it('hides RRC unread badge when rrcUnread is 0', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['RRC']}
        tabSlotIds={['RRC']}
        active={0}
        onChange={onChange}
        rrcUnread={0}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'RRC' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /RRC.*unread/ })).not.toBeInTheDocument();
  });

  it('hides Rooms unread badge when roomsUnread is 0', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        roomsUnread={0}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Rooms' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Rooms.*unread/ })).not.toBeInTheDocument();
  });

  it('caps Rooms unread badge at 99+', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        roomsUnread={150}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rooms 99+ unread' })).toBeInTheDocument();
  });

  it('has no axe violations when Rooms unread badge shows', async () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        roomsUnread={3}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(await axe(screen.getByText('3'))).toHaveNoViolations();
  });

  it('has no axe violations when Rooms unread badge shows 99+', async () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Rooms']}
        tabSlotIds={['Rooms']}
        active={0}
        onChange={onChange}
        roomsUnread={150}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(await axe(screen.getByText('99+'))).toHaveNoViolations();
  });

  it('does not show Chat and Rooms badges on the same tab (mutually exclusive slot ids)', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['Chat', 'Rooms']}
        tabSlotIds={['Chat', 'Rooms']}
        active={0}
        onChange={onChange}
        chatUnread={2}
        roomsUnread={4}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Chat 2 unread' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rooms 4 unread' })).toBeInTheDocument();
  });

  it('does not invoke onChange for disabled tabs', () => {
    const onChange = vi.fn();
    render(
      <Sidebar
        tabs={['A', 'B']}
        active={0}
        onChange={onChange}
        disabledTabs={new Set([1])}
        {...defaultProps}
      />,
    );
    const tablist = screen.getByRole('tablist');
    const bTab = within(tablist).getAllByRole('tab')[1];
    // Disabled buttons can't be clicked via userEvent, verify disabled attribute
    expect(bTab).toBeDisabled();
  });
});
