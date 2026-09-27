import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { setConnection, useConnectionStore } from '@/renderer/stores/connectionStore';

import { QuitButton } from './QuitButton';

describe('QuitButton', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connections: {} });
    vi.mocked(window.electronAPI.quitApp).mockClear();
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
  });

  it('quits in one click when nothing is connected', async () => {
    render(<QuitButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(window.electronAPI.quitApp).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.mqtt.disconnect).not.toHaveBeenCalled();
  });

  it('says Disconnect & Quit while any protocol has a link, and drops MQTT first', async () => {
    // A MeshCore radio in the background still counts while another protocol's tab is open.
    setConnection('id-meshcore-test', { status: 'configured' });
    render(<QuitButton />);
    const button = screen.getByRole('button', { name: 'Disconnect & Quit' });
    expect(button).toHaveAttribute('title', 'Disconnect & Quit');
    await userEvent.click(button);
    expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.quitApp).toHaveBeenCalledTimes(1);
  });

  it('counts an MQTT-only link as connected', () => {
    setConnection('id-meshtastic-test', { mqttStatus: 'connected' });
    render(<QuitButton />);
    expect(screen.getByRole('button', { name: 'Disconnect & Quit' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<QuitButton />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
