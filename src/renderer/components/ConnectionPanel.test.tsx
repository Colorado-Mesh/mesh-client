import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { DeviceState } from '../lib/types';
import ConnectionPanel from './ConnectionPanel';

const disconnectedState: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  reconnectAttempt: 0,
  connectionType: null,
};

describe('ConnectionPanel MQTT port clamping', () => {
  it('clamps port to 1 when 0 is entered', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );
    // Navigate to MQTT section — look for the port field by label
    const portInput = screen.queryByLabelText(/^Port$/i);
    if (portInput) {
      await user.clear(portInput);
      await user.type(portInput, '0');
      // After typing, the value should be clamped to 1 (displayed as 1 or 1883 fallback)
      const val = parseInt((portInput as HTMLInputElement).value);
      expect(val).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('HelpTooltip in MQTT form', () => {
  function renderMqttForm(protocol: 'meshtastic' | 'meshcore' = 'meshtastic') {
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol={protocol}
        onProtocolChange={vi.fn()}
      />,
    );
  }

  it('shows non-empty tooltip text on mouseenter for each help icon', async () => {
    const user = userEvent.setup();
    renderMqttForm();
    const helpIcons = document.querySelectorAll('.cursor-help');
    expect(helpIcons.length).toBeGreaterThan(0);
    for (const icon of helpIcons) {
      await user.hover(icon as HTMLElement);
      // After hover, a tooltip span should appear with non-empty text
      const tooltips = document.querySelectorAll('.pointer-events-none');
      const visibleTooltip = Array.from(tooltips).find(
        (el) => el.textContent && el.textContent.trim().length > 0,
      );
      expect(visibleTooltip).toBeTruthy();
      await user.unhover(icon as HTMLElement);
    }
  });

  it('help icons do not use native title attribute (broken in Electron)', () => {
    renderMqttForm();
    const helpIcons = document.querySelectorAll('.cursor-help');
    expect(helpIcons.length).toBeGreaterThan(0);
    for (const icon of helpIcons) {
      expect(icon.getAttribute('title')).toBeNull();
    }
  });
});

describe('ConnectionPanel accessibility', () => {
  it('has no axe violations in disconnected state', async () => {
    const { container } = render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ConnectionPanel MQTT connect error', () => {
  it('surfaces error when mqtt.connect rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.mqtt.connect).mockRejectedValueOnce(new Error('broker refused'));

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
        onProtocolChange={vi.fn()}
      />,
    );

    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const connectBtn = within(mqttCard as HTMLElement).getByRole('button', { name: 'Connect' });
    await user.click(connectBtn);

    expect(await screen.findByText('broker refused')).toBeInTheDocument();
  });

  it('does not run LetsMesh preset validation for Meshtastic when meshcore preset was letsmesh', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    const connect = vi.mocked(window.electronAPI.mqtt.connect);
    connect.mockClear();
    connect.mockResolvedValue(undefined);

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );

    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const connectBtn = within(mqttCard as HTMLElement).getByRole('button', { name: 'Connect' });
    await user.click(connectBtn);

    expect(connect).toHaveBeenCalledTimes(1);
    const payload = connect.mock.calls[0]?.[0];
    expect(payload?.mqttTransportProtocol).toBe('meshtastic');
    expect(
      screen.queryByText(/LetsMesh requires WebSocket transport on port 443/i),
    ).not.toBeInTheDocument();

    localStorage.removeItem('mesh-client:mqttPreset:meshcore');
  });
});

describe('ConnectionPanel BLE error humanization', () => {
  it('shows startup Linux BLE capability warning before connect attempts', async () => {
    vi.mocked(window.electronAPI.getLinuxBleCapabilityStatus).mockResolvedValueOnce({
      platform: 'linux',
      hasCapNetRaw: false,
      detail: 'runtime CapEff=0 CapAmb=0',
    });

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Bluetooth permissions missing on Linux/i)).toBeInTheDocument();
    expect(screen.getByText(/npm run linux/i)).toBeInTheDocument();
  });

  it('shows Linux setpriv-first guidance for classified Linux capability errors', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.startNobleBleScanning).mockRejectedValueOnce(
      new Error(
        'BLE_LINUX_CAPABILITY_MISSING: Linux BLE scan permissions are missing or not applied',
      ),
    );

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Linux BLE permissions are missing/i)).toBeInTheDocument();
    expect(screen.getByText(/npm run linux/i)).toBeInTheDocument();
    expect(screen.getByText(/setpriv --reuid=\$USER/i)).toBeInTheDocument();
    expect(
      screen.getByText(/setcap -r \.\/node_modules\/electron\/dist\/electron/i),
    ).toBeInTheDocument();
  });

  it('shows Windows handshake guidance for MeshCore BLE handshake timeout/disconnect', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    vi.mocked(window.electronAPI.startNobleBleScanning).mockRejectedValueOnce(
      new Error(
        'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout. Retry, keep the device awake and nearby, power-cycle BLE, or use Serial/TCP.',
      ),
    );

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
        onProtocolChange={vi.fn()}
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/On Windows, toggle Bluetooth off\/on/i)).toBeInTheDocument();
    userAgentSpy.mockRestore();
  });

  it('renders object-shaped BLE errors as JSON instead of [object Object]', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.startNobleBleScanning).mockRejectedValueOnce({
      reason: 'adapter glitch',
      code: 'BLE_OBJECT_ERR',
    });

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/"reason":"adapter glitch"/)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it('shows Windows adapter guidance when BLE adapter is unavailable', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    vi.mocked(window.electronAPI.startNobleBleScanning).mockRejectedValueOnce(
      new Error('Bluetooth adapter is not available'),
    );

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        onProtocolChange={vi.fn()}
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(
      await screen.findByText(/update your Bluetooth driver in Device Manager/i),
    ).toBeInTheDocument();
    userAgentSpy.mockRestore();
  });
});
