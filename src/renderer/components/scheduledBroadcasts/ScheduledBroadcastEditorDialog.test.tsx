import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { firstDueAt } from '@/renderer/lib/scheduledBroadcasts/recurrence';
import { SCHEDULED_BROADCAST_INTERVALS } from '@/shared/scheduledBroadcastTypes';

import {
  hhMmToMins,
  minsToHhMm,
  ScheduledBroadcastEditorDialog,
} from './ScheduledBroadcastEditorDialog';

describe('ScheduledBroadcastEditorDialog time helpers', () => {
  it('round-trips HH:MM through minutes', () => {
    expect(minsToHhMm(540)).toBe('09:00');
    expect(hhMmToMins('09:00')).toBe(540);
    expect(hhMmToMins('9:30')).toBe(9 * 60 + 30);
  });

  it('accepts HH:MM:SS from browsers that include seconds', () => {
    expect(hhMmToMins('09:30:00')).toBe(9 * 60 + 30);
    expect(hhMmToMins('23:59:59')).toBe(23 * 60 + 59);
  });

  it('rejects incomplete or out-of-range values without forcing a rewrite', () => {
    expect(hhMmToMins('')).toBeNull();
    expect(hhMmToMins('09:')).toBeNull();
    expect(hhMmToMins('24:00')).toBeNull();
    expect(hhMmToMins('12:60')).toBeNull();
  });
});

describe('ScheduledBroadcastEditorDialog intervals', () => {
  it('lists all eight interval options including every4h/8h/12h', () => {
    render(
      <ScheduledBroadcastEditorDialog
        slot={1}
        existing={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const select = screen.getByLabelText('Repeat');
    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values).toEqual([...SCHEDULED_BROADCAST_INTERVALS]);
  });

  it('saves every4h with time anchor and null weekday fields', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ScheduledBroadcastEditorDialog
        slot={3}
        existing={{
          slot: 3,
          label: 'Check',
          text: 'ping',
          enabled: true,
          interval: 'daily',
          timeOfDayMin: 6 * 60,
          weekday: null,
          dayOfMonth: null,
          anchorYmd: null,
          nextDueAt: null,
          lastAttemptAt: null,
          lastResult: null,
          updatedAt: 1,
          targets: [
            {
              kind: 'meshcore-channel',
              identityId: 'mc1',
              label: 'Public',
              enabled: true,
              channelIndex: 0,
            },
          ],
        }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Repeat'), 'every4h');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        interval: 'every4h',
        timeOfDayMin: 6 * 60,
        weekday: null,
        dayOfMonth: null,
        anchorYmd: null,
        nextDueAt: firstDueAt({ interval: 'every4h', timeOfDayMin: 6 * 60 }, Date.now()),
      }),
    );
  });
});

describe('ScheduledBroadcastEditorDialog focus trap', () => {
  it('does not re-focus the first control or reset scroll when onClose identity changes', () => {
    const { rerender } = render(
      <ScheduledBroadcastEditorDialog
        slot={1}
        existing={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const panel = dialog.querySelector('.overflow-y-auto');
    expect(panel).toBeInstanceOf(HTMLElement);
    const scrollPanel = panel as HTMLElement;
    Object.defineProperty(scrollPanel, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollPanel, 'clientHeight', { value: 400, configurable: true });
    scrollPanel.scrollTop = 320;

    const text = screen.getByLabelText('Message');
    text.focus();
    expect(document.activeElement).toBe(text);

    rerender(
      <ScheduledBroadcastEditorDialog
        slot={1}
        existing={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(text);
    expect(scrollPanel.scrollTop).toBe(320);
  });

  it('calls the latest onClose after the callback identity changes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ScheduledBroadcastEditorDialog slot={1} existing={null} onClose={first} onSave={vi.fn()} />,
    );
    rerender(
      <ScheduledBroadcastEditorDialog slot={1} existing={null} onClose={second} onSave={vi.fn()} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
