import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ToastProvider } from '../Toast';
import { RadioChatSyncButton } from './RadioChatSyncButton';

describe('RadioChatSyncButton', () => {
  it('supports keyboard, tooltip, busy, toast feedback, failure and retry without widening its header', async () => {
    let complete: () => void = () => {};
    const onSync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { container, rerender } = render(
      <ToastProvider>
        <header>
          <RadioChatSyncButton onSync={onSync} disabled={false} feedback="toast" />
        </header>
      </ToastProvider>,
    );
    const button = screen.getByRole('button', { name: 'Sync chats from radio' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sync chats from radio');
    await user.keyboard('{Enter}');
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onSync).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete();
      await Promise.resolve();
    });
    expect(button).toBeEnabled();
    expect(within(container.querySelector('header')!).getByRole('status')).toHaveClass('sr-only');
    expect(container.querySelector('[data-toast-stack]')).toHaveTextContent(
      'Chats synced from radio.',
    );
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveClass('sr-only');
    expect(container.querySelector('[data-toast-stack]')).toHaveTextContent('Could not read chats');
    await user.click(button);
    expect(onSync).toHaveBeenCalledTimes(3);
    expect(button).toBeEnabled();
    rerender(
      <ToastProvider>
        <header>
          <RadioChatSyncButton onSync={onSync} disabled feedback="toast" />
        </header>
      </ToastProvider>,
    );
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSync).toHaveBeenCalledTimes(3);
    await waitFor(() => {
      expect(container.querySelector('[data-toast-stack] > div:last-child')).toHaveClass(
        'opacity-100',
      );
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('retains inline feedback for the Rooms surface', async () => {
    render(<RadioChatSyncButton onSync={vi.fn().mockResolvedValue(undefined)} disabled={false} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sync chats from radio' }));
    expect(await screen.findByRole('status')).not.toHaveClass('sr-only');
  });
});
