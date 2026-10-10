import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { LogEntry } from '@/renderer/lib/logAnalyzer';
import en from '@/renderer/locales/en/translation.json';

import LogAnalyzeModal from './LogAnalyzeModal';

const entries: LogEntry[] = [
  {
    ts: 1000,
    level: 'warn',
    source: 'renderer:dbPersistRetry',
    message:
      '[dbPersistRetry] degraded persistence: saveNode failed after retries: database is locked',
  },
];

beforeEach(() => {
  vi.mocked(window.electronAPI.clipboard.writeText).mockResolvedValue(undefined);
});

describe('log analysis evidence and report', () => {
  it('expands timestamped evidence and shows the specific recommendation', async () => {
    const user = userEvent.setup();
    render(<LogAnalyzeModal isOpen onClose={vi.fn()} entries={entries} protocol="meshtastic" />);
    expect(
      screen.getByText(en.logAnalyzer.categories['database-persistence'].recommendation),
    ).toBeInTheDocument();
    const summary = screen.getByText('View evidence for Changes could not be saved');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await user.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    const evidence = screen.getByRole('list', {
      name: 'View evidence for Changes could not be saved',
    });
    expect(within(evidence).getByText(entries[0].message)).toBeInTheDocument();
    expect(evidence.querySelector('time')).toHaveAttribute('datetime', '1970-01-01T00:00:01.000Z');
    expect(evidence).toHaveTextContent('renderer:dbPersistRetry');
  });

  it('copies a report only after a click and announces success', async () => {
    const user = userEvent.setup();
    render(<LogAnalyzeModal isOpen onClose={vi.fn()} entries={entries} protocol="meshtastic" />);
    expect(window.electronAPI.clipboard.writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy troubleshooting report' }));
    expect(window.electronAPI.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(entries[0].message),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Report copied');
  });

  it('has no accessibility violations with expanded findings', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LogAnalyzeModal isOpen onClose={vi.fn()} entries={entries} protocol="meshtastic" />,
    );
    await user.click(screen.getByText('View evidence for Changes could not be saved'));
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps new evidence in the focus trap when live logs arrive', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const view = render(
      <LogAnalyzeModal isOpen onClose={onClose} entries={[]} protocol="meshtastic" />,
    );
    view.rerender(
      <LogAnalyzeModal isOpen onClose={onClose} entries={entries} protocol="meshtastic" />,
    );
    await user.tab({ shift: true });
    expect(screen.getByText('View evidence for Changes could not be saved')).toHaveFocus();
    await user.tab();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' }),
    ).toHaveFocus();
  });

  it('disables copy for empty logs and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LogAnalyzeModal isOpen onClose={onClose} entries={[]} protocol="meshcore" />);
    expect(screen.getByRole('button', { name: 'Copy troubleshooting report' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
