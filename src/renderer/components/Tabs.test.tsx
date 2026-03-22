import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import Tabs from './Tabs';

describe('Tabs', () => {
  it('clamps active index above last tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={['A', 'B', 'C']} active={99} onChange={onChange} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('clamps negative active index to first tab', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={['A', 'B', 'C']} active={-1} onChange={onChange} />);
    const tablist = screen.getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('renders empty tabs array without crashing', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[]} active={0} onChange={onChange} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('still invokes onChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={['A', 'B']} active={0} onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
