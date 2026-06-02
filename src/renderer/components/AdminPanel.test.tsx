import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import AdminPanel from './AdminPanel';
import { ToastProvider } from './Toast';

const baseProps = {
  isConnected: true,
  onReboot: vi.fn().mockResolvedValue(undefined),
  onShutdown: vi.fn().mockResolvedValue(undefined),
  onFactoryReset: vi.fn().mockResolvedValue(undefined),
  onResetNodeDb: vi.fn().mockResolvedValue(undefined),
};

const fullCapabilities = {
  hasNodeDbReset: true,
  hasFactoryReset: true,
  hasShutdown: true,
} as Parameters<typeof AdminPanel>[0]['capabilities'];

function renderAdmin(overrides: Partial<Parameters<typeof AdminPanel>[0]> = {}) {
  return render(
    <ToastProvider>
      <AdminPanel {...baseProps} capabilities={fullCapabilities} {...overrides} />
    </ToastProvider>,
  );
}

describe('AdminPanel', () => {
  it('renders Device Commands section when connected', () => {
    renderAdmin();

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Device Commands')).toBeDefined();
  });

  it('renders Danger Zone section when hasFactoryReset is true', () => {
    renderAdmin();

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Danger Zone')).toBeDefined();
  });

  it('does not render Danger Zone when hasFactoryReset is false', () => {
    renderAdmin({
      capabilities: {
        ...fullCapabilities,
        hasFactoryReset: false,
      } as Parameters<typeof AdminPanel>[0]['capabilities'],
    });

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Danger Zone')).toBeUndefined();
  });

  it('shows connect banner when disconnected', () => {
    renderAdmin({ isConnected: false });

    expect(screen.getByText('Connect to a device to modify configuration.')).toBeInTheDocument();
  });

  it('renders Reboot and Shutdown buttons when connected with capabilities', () => {
    renderAdmin();

    expect(screen.getByRole('button', { name: /reboot$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shutdown/i })).toBeInTheDocument();
  });

  it('disables local-only Enter DFU and Reboot OTA when configure target is remote', () => {
    renderAdmin({
      onEnterDfu: vi.fn().mockResolvedValue(undefined),
      onRebootOta: vi.fn().mockResolvedValue(undefined),
      configTarget: {
        mode: 'remote',
        nodeNum: 0x12345678,
        isReady: true,
        isLoading: false,
      },
    });

    expect(screen.getByRole('button', { name: /enter dfu/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reboot to ota/i })).toBeDisabled();
  });

  it('passes preserve-favorites flag on remote NodeDB reset confirm', async () => {
    const user = userEvent.setup();
    const onResetNodeDb = vi.fn().mockResolvedValue(undefined);

    renderAdmin({
      onResetNodeDb,
      configTarget: {
        mode: 'remote',
        nodeNum: 0x12345678,
        isReady: true,
        isLoading: false,
      },
    });

    await user.click(screen.getByRole('button', { name: /^reset nodedb$/i }));
    const preserveCheckbox = screen.getByRole('checkbox', {
      name: /preserve favorite nodes/i,
    });
    await user.click(preserveCheckbox);
    const resetButtons = screen.getAllByRole('button', { name: /^reset nodedb$/i });
    expect(resetButtons.length).toBeGreaterThanOrEqual(2);
    await user.click(resetButtons[1]);

    await waitFor(() => {
      expect(onResetNodeDb).toHaveBeenCalledWith(true);
    });
  });

  it('shows error toast when reboot fails', async () => {
    const user = userEvent.setup();
    const onReboot = vi.fn().mockRejectedValue(new Error('reboot failed'));

    renderAdmin({ onReboot });

    await user.click(screen.getByRole('button', { name: /^reboot$/i }));
    const rebootButtons = screen.getAllByRole('button', { name: /^reboot$/i });
    expect(rebootButtons.length).toBeGreaterThanOrEqual(2);
    await user.click(rebootButtons[1]);

    await waitFor(() => {
      expect(screen.getByText('Failed: reboot failed')).toBeInTheDocument();
    });
  });
});
