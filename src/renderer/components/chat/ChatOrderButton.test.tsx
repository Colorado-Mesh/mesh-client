import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ChatOrderButton } from './ChatOrderButton';

const items = [
  { id: '2', name: 'Zulu' },
  { id: '1', name: 'Alpha' },
  { id: '3', name: 'Beta' },
];
const ids = ['2', '1', '3'];
function open(onSave = vi.fn()) {
  render(<ChatOrderButton items={items} ids={ids} onSave={onSave} />);
  screen.getByRole('button', { name: 'Order chats' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Order chats' }));
  return onSave;
}
const rows = () => screen.getAllByRole('listitem').map((row) => row.dataset.chatOrderId);

describe('ChatOrderButton', () => {
  it('sorts alphabetically and saves stable ids without changing radio slots', () => {
    const save = open();
    fireEvent.click(screen.getByRole('button', { name: 'Sort A–Z' }));
    expect(rows()).toEqual(['1', '3', '2']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(['1', '3', '2']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('supports keyboard and touch buttons, reset, cancellation and focus restoration', () => {
    const save = open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Zulu' }), { key: 'ArrowDown' });
    expect(rows()).toEqual(['1', '2', '3']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta up' }));
    expect(rows()).toEqual(['1', '3', '2']);
    fireEvent.click(screen.getByRole('button', { name: 'Default order' }));
    expect(rows()).toEqual(ids);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Order chats' })).toHaveFocus();
  });
  it('reports a save failure and keeps the dialog retryable', () => {
    const save = open(
      vi.fn(() => {
        throw new Error('quota');
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(save).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('consumes Escape before background chat handlers and leaves their view unchanged', () => {
    const background = vi.fn();
    document.addEventListener('keydown', background);
    try {
      open();
      fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Zulu' }), { key: 'Escape' });
      expect(background).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      document.removeEventListener('keydown', background);
    }
  });
  it('has no axe violations and traps focus', async () => {
    open();
    const dialog = screen.getByRole('dialog');
    hydrateAxeThemeColors(dialog);
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(within(dialog).getByRole('button', { name: 'Sort A–Z' })).toHaveFocus();
    expect(await axe(dialog)).toHaveNoViolations();
  });
  it('disables ordering with fewer than two entries', () => {
    render(<ChatOrderButton items={[]} ids={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Order chats' })).toBeDisabled();
  });
  it('keeps focus when live chat updates rerender the parent', () => {
    const { rerender } = render(<ChatOrderButton items={items} ids={ids} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Order chats' }));
    const handle = screen.getByRole('button', { name: 'Drag Beta' });
    handle.focus();
    rerender(<ChatOrderButton items={[...items]} ids={[...ids]} onSave={vi.fn()} />);
    expect(handle).toHaveFocus();
  });
});
