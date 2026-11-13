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
  it('shows ignored other-protocol note only when exclusions exist', () => {
    const mixed: LogEntry[] = [
      ...entries,
      {
        ts: 2000,
        level: 'warn',
        source: 'main',
        message: '[meshtasticTransportLoss] serial link lost',
        protocol: 'meshtastic',
      },
    ];
    const { rerender } = render(
      <LogAnalyzeModal isOpen onClose={vi.fn()} entries={entries} protocol="meshcore" />,
    );
    expect(screen.queryByText(/lines from other radio protocols were excluded/i)).toBeNull();
    rerender(<LogAnalyzeModal isOpen onClose={vi.fn()} entries={mixed} protocol="meshcore" />);
    expect(
      screen.getByText(en.logAnalyzeModal.ignoredOtherProtocol.replace('{{count}}', '1')),
    ).toBeInTheDocument();
  });

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

  it('reports clipboard failure and allows retry', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.clipboard.writeText).mockRejectedValueOnce(
      new Error('clipboard unavailable'),
    );
    render(<LogAnalyzeModal isOpen onClose={vi.fn()} entries={entries} protocol="reticulum" />);
    const copy = screen.getByRole('button', { name: 'Copy troubleshooting report' });
    await user.click(copy);
    expect(screen.getByRole('alert')).toHaveTextContent(en.logAnalyzeModal.copyFailure);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('copy report failed'));
    await user.click(copy);
    expect(screen.getByRole('status')).toHaveTextContent('Report copied');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    warn.mockRestore();
  });

  it('keeps unrecognized errors visible and limits rendered evidence', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...entries[0],
      ts: index * 1000,
      message: `Unrecognized error ${index}`,
    }));
    render(<LogAnalyzeModal isOpen onClose={vi.fn()} entries={many} protocol="reticulum" />);
    expect(screen.queryByText(en.logAnalyzeModal.emptyState)).not.toBeInTheDocument();
    await user.click(screen.getByText('View evidence for Other warnings and errors'));
    const evidence = screen.getByRole('list', {
      name: 'View evidence for Other warnings and errors',
    });
    expect(within(evidence).getAllByRole('listitem')).toHaveLength(20);
    expect(
      screen.getByText('Showing 20 of 30 matching entries, newest first.'),
    ).toBeInTheDocument();
    expect(evidence).toHaveTextContent('Unrecognized error 29');
    expect(evidence).not.toHaveTextContent('Unrecognized error 0');
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
