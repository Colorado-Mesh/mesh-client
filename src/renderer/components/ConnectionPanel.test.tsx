import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { SerialPort } from '@/shared/electron-api.types';

import type { FirmwareCheckResult } from '../lib/firmwareCheck';
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
      />,
    );
  }

  it('shows non-empty tooltip text on mouseenter for each help icon', async () => {
    const user = userEvent.setup();
    renderMqttForm();
    const helpIcons = document.querySelectorAll('.cursor-help');
    expect(helpIcons.length).toBeGreaterThan(0);
    for (const icon of helpIcons) {
      await user.hover(icon);
      // After hover, a tooltip span should appear with non-empty text
      const tooltips = document.querySelectorAll('.pointer-events-none');
      const visibleTooltip = Array.from(tooltips).find(
        (el) => el.textContent && el.textContent.trim().length > 0,
      );
      expect(visibleTooltip).toBeTruthy();
      await user.unhover(icon);
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
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ConnectionPanel MQTT connect error', () => {
  it('surfaces error when mqtt.connect rejects', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.mqtt.connect).mockRejectedValueOnce(new Error('broker refused'));

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const connectBtn = within(mqttCard as HTMLElement).getByRole('button', { name: 'Connect' });
    await user.click(connectBtn);

    expect(await screen.findByText('broker refused')).toBeInTheDocument();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ConnectionPanel\].*broker refused/s),
    );
    consoleWarnSpy.mockRestore();
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
  it('shows Windows handshake guidance for MeshCore BLE handshake timeout/disconnect', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/On Windows, toggle Bluetooth off\/on/i)).toBeInTheDocument();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /\[ConnectionPanel\].*Bluetooth connected but MeshCore protocol handshake/s,
      ),
    );
    consoleWarnSpy.mockRestore();
    userAgentSpy.mockRestore();
  });

  it('renders object-shaped BLE errors as JSON instead of [object Object]', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
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
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/"reason":"adapter glitch"/)).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ConnectionPanel\].*"reason":"adapter glitch"/s),
    );
    consoleWarnSpy.mockRestore();
    userAgentSpy.mockRestore();
  });

  it('shows Windows adapter guidance when BLE adapter is unavailable', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(
      await screen.findByText(/update your Bluetooth driver in Device Manager/i),
    ).toBeInTheDocument();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ConnectionPanel\].*Bluetooth adapter is not available/s),
    );
    consoleWarnSpy.mockRestore();
    userAgentSpy.mockRestore();
  });
});

describe('ConnectionPanel Linux BLE path', () => {
  it('uses Web Bluetooth connect path on Linux instead of noble scanning', async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    const onConnect = vi.fn().mockResolvedValue(undefined);

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith('ble', undefined);
    expect(window.electronAPI.startNobleBleScanning).not.toHaveBeenCalled();
    userAgentSpy.mockRestore();
  });

  it('keeps MeshCore PIN guidance in Linux BLE pairing-related errors', async () => {
    const user = userEvent.setup();
    vi.clearAllMocks();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    const onConnect = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout.',
        ),
      );

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Bluetooth Companion mode/i)).toBeInTheDocument();
    expect(screen.getByText(/paired with your computer using a PIN/i)).toBeInTheDocument();
    userAgentSpy.mockRestore();
  });
});

// ─── Firmware status indicator ────────────────────────────────────

const configuredState: DeviceState = {
  status: 'configured',
  myNodeNum: 1,
  connectionType: 'ble',
  firmwareVersion: '2.5.3',
};

function renderWithFirmware(
  firmwareCheckState?: FirmwareCheckResult,
  onOpenFirmwareReleases?: () => void,
) {
  return render(
    <ConnectionPanel
      state={configuredState}
      onConnect={vi.fn().mockResolvedValue(undefined)}
      onAutoConnect={vi.fn().mockResolvedValue(undefined)}
      onDisconnect={vi.fn().mockResolvedValue(undefined)}
      mqttStatus="disconnected"
      protocol="meshtastic"
      firmwareCheckState={firmwareCheckState}
      onOpenFirmwareReleases={onOpenFirmwareReleases}
    />,
  );
}

describe('ConnectionPanel firmware status indicator', () => {
  it('shows plain firmware version text without indicator when firmwareCheckState is not passed', () => {
    renderWithFirmware();
    expect(screen.getByText('2.5.3')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Firmware is up to date')).not.toBeInTheDocument();
  });

  it('hides firmware row entirely when firmwareVersion is undefined', () => {
    render(
      <ConnectionPanel
        state={{ ...configuredState, firmwareVersion: undefined }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        firmwareCheckState={{ phase: 'up-to-date', latestVersion: '2.5.4' }}
        onOpenFirmwareReleases={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Firmware/)).not.toBeInTheDocument();
  });

  it('shows spinner for checking phase', () => {
    renderWithFirmware({ phase: 'checking' }, vi.fn());
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows green checkmark for up-to-date phase', () => {
    renderWithFirmware({ phase: 'up-to-date', latestVersion: '2.5.3' }, vi.fn());
    expect(screen.getByLabelText('Firmware is up to date')).toBeInTheDocument();
  });

  it('shows amber update button with version for update-available phase', () => {
    renderWithFirmware({ phase: 'update-available', latestVersion: '2.5.4' }, vi.fn());
    expect(screen.getByLabelText('Firmware update available: v2.5.4')).toBeInTheDocument();
    expect(screen.getByText('v2.5.4')).toBeInTheDocument();
  });

  it('calls onOpenFirmwareReleases when update-available button is clicked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderWithFirmware({ phase: 'update-available', latestVersion: '2.5.4' }, onOpen);
    await user.click(screen.getByLabelText('Firmware update available: v2.5.4'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations with update-available indicator', async () => {
    const { container } = renderWithFirmware(
      { phase: 'update-available', latestVersion: '2.5.4' },
      vi.fn(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ConnectionPanel Meshtastic MQTT presets — Liam's server", () => {
  function renderMeshtasticMqtt() {
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
  }

  it("clicking Liam's preset populates liamcottle.net credentials", async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    await user.click(screen.getByRole('button', { name: "Liam's" }));

    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe(
      'mqtt.meshtastic.liamcottle.net',
    );
    expect(screen.getByLabelText<HTMLInputElement>(/^Port$/i).value).toBe('1883');
    expect(screen.getByLabelText<HTMLInputElement>(/^Username$/i).value).toBe('uplink');
  });

  it("shows uplink-only warning when Liam's preset is active", async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    await user.click(screen.getByRole('button', { name: "Liam's" }));

    expect(screen.getByText(/uplink-only/i)).toBeInTheDocument();
  });

  it('hides uplink-only warning for official presets', async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    // First activate Liam's, then switch away
    await user.click(screen.getByRole('button', { name: "Liam's" }));
    await user.click(screen.getByRole('button', { name: 'MQTT :1883' }));

    expect(screen.queryByText(/uplink-only/i)).not.toBeInTheDocument();
  });
});

describe('ConnectionPanel MQTT cancel while connecting', () => {
  it('calls mqtt.disconnect with meshtastic when Cancel is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="connecting"
        protocol="meshtastic"
      />,
    );
    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const cancelBtn = within(mqttCard as HTMLElement).getByRole('button', { name: /^Cancel$/i });
    await user.click(cancelBtn);
    expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledWith('meshtastic');
  });

  it('calls mqtt.disconnect with meshcore when Cancel is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="connecting"
        protocol="meshcore"
      />,
    );
    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const cancelBtn = within(mqttCard as HTMLElement).getByRole('button', { name: /^Cancel$/i });
    await user.click(cancelBtn);
    expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledWith('meshcore');
  });
});

describe('ConnectionPanel exit actions', () => {
  it('shows Quit on Meshtastic disconnected view when MQTT is off', () => {
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    expect(screen.getByRole('button', { name: /^Quit$/i })).toBeInTheDocument();
  });

  it('shows Quit on MeshCore disconnected view when MQTT is off', () => {
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );
    expect(screen.getByRole('button', { name: /^Quit$/i })).toBeInTheDocument();
  });

  it('shows Disconnect & Quit while status is reconnecting', () => {
    render(
      <ConnectionPanel
        state={{
          ...disconnectedState,
          status: 'reconnecting',
          connectionType: 'ble',
          connectionLoss: true,
          reconnectAttempt: 2,
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    expect(screen.getByRole('button', { name: /Disconnect & Quit/i })).toBeInTheDocument();
  });

  it('shows Disconnect & Quit while RF connect is in progress', async () => {
    const user = userEvent.setup();
    let resolveConnect!: () => void;
    const onConnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('radio', { name: /tcp\/ip/i }));
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(screen.getByRole('button', { name: /Disconnect & Quit/i })).toBeInTheDocument();
    resolveConnect();
    await waitFor(() => {
      expect(onConnect).toHaveBeenCalled();
    });
  });

  it('shows Quit after connect failure returns to disconnected view', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onConnect = vi.fn().mockRejectedValue(new Error('Connection refused'));
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('radio', { name: /wifi\/http/i }));
    const hostInput = within(radioCard as HTMLElement).getByLabelText(/device address/i);
    fireEvent.change(hostInput, { target: { value: '192.168.1.10' } });
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Quit$/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Radio Connection')).toBeInTheDocument();
    consoleWarnSpy.mockRestore();
  });

  it('shows Disconnect & Quit on disconnected view when MQTT is connected', () => {
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="connected"
        protocol="meshtastic"
      />,
    );
    expect(screen.getByRole('button', { name: /Disconnect & Quit/i })).toBeInTheDocument();
  });

  it('shows Disconnect & Quit while serial port picker is open', async () => {
    const user = userEvent.setup();
    let capturedCb: ((ports: SerialPort[]) => void) | undefined;
    vi.mocked(window.electronAPI.onSerialPortsDiscovered).mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    const onConnect = vi.fn(() => new Promise<void>(() => {}));

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();
    await user.click(within(radioCard as HTMLElement).getByRole('radio', { name: /USB Serial/i }));
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith('serial', 'meshtastic.local');
    expect(capturedCb).toBeDefined();

    act(() => {
      flushSync(() => {
        capturedCb!([
          { portId: 'port-1', displayName: 'Meshtastic USB', portName: '/dev/ttyUSB0' },
        ]);
      });
    });

    expect(screen.getByText('Select Serial Port')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect & Quit/i })).toBeInTheDocument();
  });

  it('shows Quit after HTTP reconnect failure from last-connection card', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({ type: 'http', httpAddress: '192.168.1.10' }),
    );
    const onConnect = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
      render(
        <ConnectionPanel
          state={disconnectedState}
          onConnect={onConnect}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );

      await user.click(screen.getByRole('button', { name: /^Reconnect$/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Quit$/i })).toBeInTheDocument();
      });
      expect(onConnect).toHaveBeenCalledWith('http', '192.168.1.10');
      expect(screen.getByText('Radio Connection')).toBeInTheDocument();
    } finally {
      localStorage.removeItem(lastConnKey);
      consoleWarnSpy.mockRestore();
    }
  });
});

describe('ConnectionPanel MeshCore TCP port field', () => {
  it('renders host and port inputs with default port 5000 when TCP/IP is selected', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();

    const tcpBtn = within(radioCard as HTMLElement).getByRole('radio', { name: /tcp\/ip/i });
    await user.click(tcpBtn);

    const hostInput = within(radioCard as HTMLElement).getByLabelText(/^Host$/i);
    const portInput = within(radioCard as HTMLElement).getByLabelText(/^Port$/i);
    expect(hostInput).toBeInTheDocument();
    expect(portInput).toBeInTheDocument();
    expect((portInput as HTMLInputElement).value).toBe('5000');
  });

  it('passes host:port to onConnect when a custom port is set', async () => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    expect(radioCard).toBeTruthy();

    const tcpBtn = within(radioCard as HTMLElement).getByRole('radio', { name: /tcp\/ip/i });
    await user.click(tcpBtn);

    const portInput = within(radioCard as HTMLElement).getByLabelText(/^Port$/i);
    fireEvent.change(portInput, { target: { value: '5001' } });

    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith('http', 'localhost:5001');
    consoleWarnSpy.mockRestore();
  });

  it.each([
    ['0', 'localhost:5000'],
    ['65536', 'localhost:5000'],
    ['abc', 'localhost:5000'],
  ])('falls back to port 5000 for invalid port %s', async (badPort, expectedAddress) => {
    const user = userEvent.setup();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={onConnect}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );

    const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
    const tcpBtn = within(radioCard as HTMLElement).getByRole('radio', { name: /tcp\/ip/i });
    await user.click(tcpBtn);

    const portInput = within(radioCard as HTMLElement).getByLabelText(/^Port$/i);
    fireEvent.change(portInput, { target: { value: badPort } });

    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith('http', expectedAddress);
    consoleWarnSpy.mockRestore();
  });
});

describe('ConnectionPanel MQTT channel PSKs', () => {
  const KEY_A = '1PG7OiApB1nwvP+rz05pAQ==';
  const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';

  function renderMeshtasticMqtt() {
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
  }

  it('passes multiple comma-separated channel PSKs to mqtt.connect without blur', async () => {
    const user = userEvent.setup();
    const connect = vi.mocked(window.electronAPI.mqtt.connect);
    connect.mockClear();
    connect.mockResolvedValue(undefined);

    renderMeshtasticMqtt();

    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    expect(mqttCard).toBeTruthy();
    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, `${KEY_A}, ${KEY_B}`);

    const connectBtn = within(mqttCard as HTMLElement).getByRole('button', { name: 'Connect' });
    await user.click(connectBtn);

    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        channelPsks: [KEY_A, KEY_B],
      }),
    );
  });

  it('keeps a trailing newline while typing a second PSK and commits both on blur', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('mesh-client:mqttSettings');
    renderMeshtasticMqtt();

    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, KEY_A);
    await user.keyboard('{Enter}');
    expect(textarea.value).toBe(`${KEY_A}\n`);
    await user.type(textarea, KEY_B);
    expect(textarea.value).toBe(`${KEY_A}\n${KEY_B}`);
    fireEvent.blur(textarea);

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('mesh-client:mqttSettings') ?? '{}');
      expect(saved.channelPsks).toEqual([KEY_A, KEY_B]);
    });
  });
});
