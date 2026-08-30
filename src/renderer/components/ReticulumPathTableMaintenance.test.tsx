import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
  }),
}));

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

import { RETICULUM_CLEAR_PATH_TABLE_ROUTE } from '@/renderer/lib/reticulum/reticulumClearPathTable';

import { ReticulumPathTableMaintenance } from './ReticulumPathTableMaintenance';

const proxyPost = vi.fn();

describe('ReticulumPathTableMaintenance', () => {
  beforeEach(() => {
    addToast.mockReset();
    proxyPost.mockReset();
    proxyPost.mockResolvedValue({ ok: true, cleared: 3 });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      reticulum: { proxyPost },
    };
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  async function confirmClear(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPathTable.clearAria' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPathTable.confirmAction' }),
    );
  }

  it('disables the control and sends nothing when the sidecar API is not ready', async () => {
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance disabled />);

    const button = screen.getByRole('button', {
      name: 'networkPanel.reticulumPathTable.clearAria',
    });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(
      screen.queryByText('networkPanel.reticulumPathTable.confirmTitle'),
    ).not.toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('opens the confirm modal without clearing anything', async () => {
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPathTable.clearAria' }),
    );

    expect(screen.getByText('networkPanel.reticulumPathTable.confirmTitle')).toBeInTheDocument();
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('posts the maintenance route once and toasts the cleared count on confirm', async () => {
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await confirmClear(user);

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledTimes(1);
    });
    expect(proxyPost).toHaveBeenCalledWith(RETICULUM_CLEAR_PATH_TABLE_ROUTE, {});
    expect(RETICULUM_CLEAR_PATH_TABLE_ROUTE).toBe('/api/v1/maintenance/path-table');
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('networkPanel.reticulumPathTable.clearOk:3', 'success');
    });
  });

  it('clears nothing when the confirm modal is cancelled', async () => {
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPathTable.clearAria' }),
    );
    // ConfirmModal renders both a backdrop close and a cancel button under common.cancel.
    const cancelButtons = screen.getAllByRole('button', { name: 'common.cancel' });
    await user.click(cancelButtons[cancelButtons.length - 1]);

    expect(proxyPost).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('toasts an error when the sidecar reports failure', async () => {
    proxyPost.mockResolvedValue({ ok: false, error: 'transport query timed out' });
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await confirmClear(user);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('networkPanel.reticulumPathTable.clearFailed', 'error');
    });
    expect(addToast).not.toHaveBeenCalledWith(expect.stringContaining('clearOk'), 'success');
  });

  it('toasts an error when the request rejects', async () => {
    proxyPost.mockRejectedValue(new Error('ipc down'));
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await confirmClear(user);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('networkPanel.reticulumPathTable.clearFailed', 'error');
    });
  });

  it('re-enables the button after a failure so the action can be retried', async () => {
    proxyPost.mockRejectedValue(new Error('ipc down'));
    const user = userEvent.setup();
    render(<ReticulumPathTableMaintenance />);

    await confirmClear(user);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'networkPanel.reticulumPathTable.clearAria' }),
      ).not.toBeDisabled();
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(<ReticulumPathTableMaintenance />);
    hydrateAxeThemeColors(container);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
