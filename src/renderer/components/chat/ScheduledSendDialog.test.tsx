import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import i18n from '@/renderer/lib/i18n';
import { toDateTimeLocalValue } from '@/renderer/lib/scheduledSend';

import { ScheduledSendDialog } from './ScheduledSendDialog';

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduledSendDialog', () => {
  it('confirms a future time with the composer text', async () => {
    const onConfirm = vi
      .fn<(r: { text: string; scheduledAt: number }) => Promise<boolean>>()
      .mockResolvedValue(true);
    const at = Date.now() + 2 * HOUR;
    render(
      <ScheduledSendDialog
        mode="create"
        text="see you at noon"
        initialAt={at}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('scheduled-send-preview')).toHaveTextContent('see you at noon');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.text).toBe('see you at noon');
    // datetime-local has minute precision.
    expect(Math.abs(arg.scheduledAt - at)).toBeLessThan(60_000);
  });

  it('rejects a past time without calling onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <ScheduledSendDialog
        mode="create"
        text="late"
        initialAt={Date.now() - HOUR}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a time in the future.');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects a time beyond the 30 day horizon', async () => {
    const onConfirm = vi.fn();
    render(
      <ScheduledSendDialog
        mode="create"
        text="far"
        initialAt={Date.now() + 40 * 24 * HOUR}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('within the next 30 days');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('applies presets and lets edit mode change the text', async () => {
    // Freeze time so preset fill, validation, and expectation share one clock.
    const frozenNow = Date.parse('2026-06-15T12:00:00.000Z');
    vi.useFakeTimers({ now: frozenNow });
    const onConfirm = vi
      .fn<(r: { text: string; scheduledAt: number }) => Promise<boolean>>()
      .mockResolvedValue(true);
    render(
      <ScheduledSendDialog
        mode="edit"
        text="old"
        initialAt={Date.now() + HOUR}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'new text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'In 15 minutes' }));
    const input = screen.getByLabelText<HTMLInputElement>('Send at');
    expect(input.value).toBe(toDateTimeLocalValue(frozenNow + 15 * 60_000));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].text).toBe('new text');
  });

  it('shows an error and stays open when saving fails', async () => {
    const onConfirm = vi.fn().mockResolvedValue(false);
    render(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not re-focus the first control when onCancel identity changes', () => {
    const { rerender } = render(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const when = screen.getByLabelText('Send at');
    when.focus();
    expect(document.activeElement).toBe(when);

    rerender(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(when);
  });

  it('calls the latest onCancel after the callback identity changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={first}
      />,
    );
    rerender(
      <ScheduledSendDialog
        mode="create"
        text="x"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={second}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ScheduledSendDialog
        mode="edit"
        text="hello"
        initialAt={Date.now() + HOUR}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
