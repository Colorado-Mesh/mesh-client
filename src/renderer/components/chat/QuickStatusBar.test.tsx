// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { DEFAULT_QUICK_STATUS_PRESETS } from '@/renderer/lib/quickStatusMessages';

import { QuickStatusBar } from './QuickStatusBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

describe('QuickStatusBar', () => {
  it('renders one button per default preset and sends the preset wire text', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<QuickStatusBar onSend={onSend} />);
    expect(screen.getAllByRole('button')).toHaveLength(DEFAULT_QUICK_STATUS_PRESETS.length);
    await user.click(screen.getByText('quickStatus.needHelp'));
    expect(onSend).toHaveBeenCalledWith('Need help');
  });

  it('disables all buttons when disabled', () => {
    render(<QuickStatusBar onSend={vi.fn()} onRollCall={vi.fn()} disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('shows Roll call only when onRollCall is provided', async () => {
    const user = userEvent.setup();
    const onRollCall = vi.fn();
    const { rerender } = render(<QuickStatusBar onSend={vi.fn()} />);
    expect(screen.queryByText('quickStatus.rollCall')).toBeNull();
    rerender(<QuickStatusBar onSend={vi.fn()} onRollCall={onRollCall} />);
    await user.click(screen.getByText('quickStatus.rollCall'));
    expect(onRollCall).toHaveBeenCalledOnce();
  });

  it('has no axe violations', async () => {
    const { container } = render(<QuickStatusBar onSend={vi.fn()} onRollCall={vi.fn()} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
