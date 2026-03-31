import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import LogPanel from './LogPanel';

describe('LogPanel accessibility', () => {
  it('has no axe violations with empty log', async () => {
    const { container } = render(<LogPanel />);
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows role="alert" when clear log rejects', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn');
    vi.mocked(window.electronAPI.log.clear).mockRejectedValueOnce(new Error('clear failed'));
    render(<LogPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: 'Delete log' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('clear failed');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LogPanel]'),
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });
});
