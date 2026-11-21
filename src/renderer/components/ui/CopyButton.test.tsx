import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  const writeText = vi.mocked(window.electronAPI.clipboard.writeText);

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies the text through the app clipboard and announces Copied', async () => {
    const user = userEvent.setup();
    render(<CopyButton text="Alpha > Bravo > Charlie" label="Copy route" />);
    await user.click(screen.getByRole('button', { name: 'Copy route' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Alpha > Bravo > Charlie');
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
  });

  it('builds the text when clicked, not when rendered', async () => {
    const user = userEvent.setup();
    const build = vi.fn(() => 'built at click');
    render(<CopyButton text={build} label="Copy route" />);
    expect(build).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy route' }));
    expect(build).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('built at click');
  });

  it('says the copy failed, and never Copied, when the clipboard refuses', async () => {
    const warn = mockConsoleWarn();
    try {
      writeText.mockRejectedValueOnce(new Error('denied'));
      const user = userEvent.setup();
      render(<CopyButton text="x" label="Copy route" />);
      await user.click(screen.getByRole('button', { name: 'Copy route' }));
      expect(await screen.findByRole('status')).toHaveTextContent("Couldn't copy");
      expect(screen.queryByText('Copied')).not.toBeInTheDocument();
      expect(warn.spy).toHaveBeenCalled();
    } finally {
      warn.restore();
    }
  });

  it('says the copy failed when building the text throws', async () => {
    const warn = mockConsoleWarn();
    try {
      const user = userEvent.setup();
      render(
        <CopyButton
          text={() => {
            throw new Error('builder broke');
          }}
          label="Copy route"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Copy route' }));
      expect(await screen.findByRole('status')).toHaveTextContent("Couldn't copy");
      expect(writeText).not.toHaveBeenCalled();
      expect(warn.spy).toHaveBeenCalled();
    } finally {
      warn.restore();
    }
  });

  it('clears the Copied state after a short time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<CopyButton text="x" label="Copy route" />);
    await user.click(screen.getByRole('button', { name: 'Copy route' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('has no axe violations', async () => {
    const { container } = render(<CopyButton text="x" label="Copy route" />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
