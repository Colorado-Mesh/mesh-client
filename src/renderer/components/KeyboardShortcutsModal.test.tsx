import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import KeyboardShortcutsModal from './KeyboardShortcutsModal';

describe('KeyboardShortcutsModal accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('KeyboardShortcutsModal focus trap', () => {
  it('focuses the first focusable control inside the dialog on open', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const firstFocusable = within(dialog).getAllByRole('button')[0];
    expect(firstFocusable).toHaveFocus();
  });

  it('wraps Tab from last focusable to first', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    expect(last).toHaveFocus();
    await user.tab();
    expect(buttons[0]).toHaveFocus();
  });

  it('wraps Shift+Tab from first focusable to last', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(buttons[buttons.length - 1]).toHaveFocus();
  });
});
