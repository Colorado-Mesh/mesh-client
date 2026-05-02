import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { MESSAGE_RETENTION_KEYS } from '../lib/messageRetention';
import AppPanel from './AppPanel';
import { ToastProvider } from './Toast';

describe('AppPanel accessibility', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodes: new Map(),
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  it('has no axe violations with empty state', async () => {
    const { container } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('AppPanel: DB-backed message retention card (issue #387)', () => {
  const defaultProps = {
    nodes: new Map(),
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockReset();
    vi.mocked(window.electronAPI.appSettings.set).mockReset();
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '4000',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: '4000',
    });
    vi.mocked(window.electronAPI.appSettings.set).mockResolvedValue({ changes: 1 });
  });

  it('hydrates the meshtastic count from the SQLite-backed app_settings IPC', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '7500',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: '4000',
    });

    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 7500 messages/i);
    expect(input).toHaveValue(7500);
  });

  it('debounces count edits and persists via appSettings.set with the meshtastic key', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 4000 messages/i);

    fireEvent.change(input, { target: { value: '6000' } });
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalledWith(
      MESSAGE_RETENTION_KEYS.meshtasticCount,
      expect.anything(),
    );

    await waitFor(
      () => {
        expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
          MESSAGE_RETENTION_KEYS.meshtasticCount,
          '6000',
        );
      },
      { timeout: 1500 },
    );
  });

  it('toggling the checkbox writes "1"/"0" via appSettings.set', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshtastic" />
      </ToastProvider>,
    );

    // Distinguish the checkbox (no count suffix) from the number input.
    const checkbox = await screen.findByRole('checkbox', {
      name: /^Cap stored messages, keep newest$/,
    });

    await waitFor(() => {
      expect(checkbox).toBeChecked();
    });

    act(() => {
      fireEvent.click(checkbox);
    });

    await waitFor(() => {
      expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith(
        MESSAGE_RETENTION_KEYS.meshtasticEnabled,
        '0',
      );
    });
  });

  it('shows the meshcore field when protocol is meshcore', async () => {
    render(
      <ToastProvider>
        <AppPanel {...defaultProps} protocol="meshcore" />
      </ToastProvider>,
    );

    const input = await screen.findByLabelText(/Cap stored messages, keep newest 4000 messages/i);
    expect(input.id).toBe('apppanel-message-retention-meshcore-count');
  });
});
