import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import { QuitButton } from './QuitButton';

describe('QuitButton', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    useIncidentStore.setState({ incidents: {} });
    vi.mocked(window.electronAPI.quitApp).mockClear();
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    vi.mocked(window.electronAPI.cancelSerialSelection).mockClear();
  });

  it('quits in one click when nothing would be cut off', async () => {
    render(<QuitButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    await waitFor(() => {
      expect(window.electronAPI.quitApp).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.electronAPI.mqtt.disconnect).not.toHaveBeenCalled();
    // The same cancel step as the Connection panel: no new connect starts while closing.
    expect(window.electronAPI.cancelSerialSelection).toHaveBeenCalled();
  });

  it('asks first while any protocol has a link up, then disconnects and quits', async () => {
    // A MeshCore radio in the background counts while another protocol's tab is open.
    setConnection('id-meshcore-test', { status: 'configured' });
    render(<QuitButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect & Quit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Quit Mesh Hub?' });
    expect(dialog).toHaveTextContent('Every radio and MQTT link will disconnect.');
    expect(window.electronAPI.quitApp).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect & Quit' }));
    await waitFor(() => {
      expect(window.electronAPI.quitApp).toHaveBeenCalledTimes(1);
    });
    expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledTimes(1);
  });

  it('names open MAYDAY or URGENT incidents and waiting emergency messages, and can be cancelled', async () => {
    useIncidentStore.setState({
      incidents: {
        a: { severity: 0, status: 'open', isDrill: false },
        b: { severity: 3, status: 'open', isDrill: false },
      } as never,
    });
    vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValueOnce([
      { priority: 'emergency' },
      { priority: 'normal' },
    ] as never);
    render(<QuitButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Quit Mesh Hub?' });
    expect(dialog).toHaveTextContent('Open MAYDAY or URGENT incidents: 1.');
    expect(dialog).toHaveTextContent('Emergency messages still waiting to send: 1.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.electronAPI.quitApp).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(<QuitButton />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
