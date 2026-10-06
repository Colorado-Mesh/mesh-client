import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetChatMacrosStoreForTests,
  useChatMacrosStore,
} from '@/renderer/stores/chatMacrosStore';

import { EditMacrosDialog } from './EditMacrosDialog';

describe('EditMacrosDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    resetChatMacrosStoreForTests();
  });

  it('saves label and text as you type', () => {
    render(<EditMacrosDialog protocol="meshtastic" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'F1 button label' }), {
      target: { value: 'Roger' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'F1 message text' }), {
      target: { value: 'Roger, copy that.' },
    });
    expect(useChatMacrosStore.getState().slots[0]).toEqual({
      label: 'Roger',
      text: 'Roger, copy that.',
    });
    expect(screen.getByText('17 B')).toBeInTheDocument();
  });

  it('switches send mode and size', () => {
    render(<EditMacrosDialog protocol="meshtastic" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Send now' }));
    fireEvent.click(screen.getByRole('radio', { name: /Medium/ }));
    const s = useChatMacrosStore.getState();
    expect(s.sendMode).toBe('sendNow');
    expect(s.size).toBe('medium');
    expect(screen.getByRole('radio', { name: /Medium/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('flags text longer than one message for the protocol', () => {
    useChatMacrosStore.getState().setSlotText(2, 'a'.repeat(171));
    render(<EditMacrosDialog protocol="meshcore" onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'F3 message text' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toContain('border-red-500');
    expect(screen.getByText('171 B')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'F1 message text' })).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  it('focuses the requested row, closes on Escape and restores focus', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <EditMacrosDialog protocol="meshtastic" initialFocusIndex={4} onClose={onClose} />,
    );
    expect(screen.getByRole('textbox', { name: 'F5 button label' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('has no axe violations, including the over-limit state', async () => {
    useChatMacrosStore.getState().setSlotLabel(0, 'Roger');
    useChatMacrosStore.getState().setSlotText(0, 'Roger, copy that.');
    useChatMacrosStore.getState().setSlotText(2, 'a'.repeat(171));
    render(<EditMacrosDialog protocol="meshcore" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit macros' });
    hydrateAxeThemeColors(document.body);
    expect(await axe(dialog)).toHaveNoViolations();
  });
});
