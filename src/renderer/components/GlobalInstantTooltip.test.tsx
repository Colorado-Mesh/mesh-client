import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { GlobalInstantTooltip } from './GlobalInstantTooltip';
import { HelpTooltip } from './HelpTooltip';

describe('GlobalInstantTooltip', () => {
  it('shows an instant tooltip for elements with a native title on hover', async () => {
    const user = userEvent.setup();
    render(
      <>
        <GlobalInstantTooltip />
        <button type="button" title="Refresh data">
          Refresh
        </button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh data');
    expect(button.getAttribute('title')).toBeNull();
    await user.unhover(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button.getAttribute('title')).toBe('Refresh data');
  });

  it('shows tooltip on keyboard focus', () => {
    render(
      <>
        <GlobalInstantTooltip />
        <button type="button" title="Keyboard tip">
          Action
        </button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Action' });
    act(() => {
      fireEvent.focus(button);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Keyboard tip');
    act(() => {
      fireEvent.blur(button);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not intercept HelpTooltip-managed triggers', async () => {
    const user = userEvent.setup();
    render(
      <>
        <GlobalInstantTooltip />
        <HelpTooltip text="Managed help" />
      </>,
    );
    const trigger = document.querySelector('.cursor-help')!;
    await user.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Managed help');
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  });
});
