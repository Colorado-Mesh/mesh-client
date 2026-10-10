import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { GattBleDevice, SerialPort } from '@/shared/electron-api.types';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { FirmwareCheckResult } from '../lib/firmwareCheck';
import { MESHCORE_IDENTITY_STORAGE_KEY } from '../lib/letsMeshJwt';
import {
  initNobleBleDualRadioStartup,
  resetNobleBleConnectMutexForTests,
} from '../lib/meshcoreDualNobleBleInit';
import type { DeviceState } from '../lib/types';
import { mockConsoleWarn, withMockedConsoleWarn } from '../lib/vitestConsoleMock';
import ConnectionPanel from './ConnectionPanel';

const disconnectedState: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  reconnectAttempt: 0,
  connectionType: null,
};

const NOBLE_PLATFORM_USER_AGENT = {
  darwin:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  win32: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
} as const;

function mockNobleBlePlatform(platform: 'darwin' | 'win32'): {
  userAgentSpy: ReturnType<typeof vi.spyOn>;
  restore: () => void;
} {
  vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
  const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
  userAgentSpy.mockReturnValue(NOBLE_PLATFORM_USER_AGENT[platform]);
  return {
    userAgentSpy,
    restore: () => {
      userAgentSpy.mockRestore();
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    },
  };
}

function mockMacNoblePlatform(): ReturnType<typeof mockNobleBlePlatform> {
  return mockNobleBlePlatform('darwin');
}

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
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations for MeshCore disconnected state', async () => {
    const { container } = render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe('ConnectionPanel MQTT connect error', () => {
  it('surfaces error when mqtt.connect rejects', async () => {
    const user = userEvent.setup();
    const { spy: consoleWarnSpy, restore } = mockConsoleWarn();
    vi.mocked(window.electronAPI.mqtt.connect).mockRejectedValueOnce(new Error('broker refused'));
    // Custom (non–device-signing) so Connect reaches mqtt.connect without JWT/identity gates.
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'custom');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt.example.com',
        port: 1883,
        username: '',
        password: '',
        topicPrefix: 'meshcore/chat',
        useWebSocket: false,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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
    restore();
    localStorage.clear();
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

describe('ConnectionPanel MeshCore MQTT presets', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists all MeshCore presets in the network preset picker', () => {
    localStorage.setItem('mesh-client:coloradoMqttRegionAck-v1', '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([
      'LetsMesh',
      'MeshMapper',
      'Colorado Mesh',
      'Waev',
      'Meshat.se',
      'MeshCore.CA',
      'EastMesh',
      'Ripple Networks',
      'Custom',
    ]);
  });

  it('applies Waev broker fields when selected from the picker', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:coloradoMqttRegionAck-v1', '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'Waev' }));

    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('waev');
    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe('mqtt.waev.app');
    expect(screen.getByLabelText<HTMLInputElement>(/^Port$/i).value).toBe('443');
  });

  function renderLetsMeshMeshcorePanel() {
    localStorage.setItem('mesh-client:coloradoMqttRegionAck-v1', '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );
  }

  it('normalizes an IATA topic prefix on blur without leaving the preset', async () => {
    const user = userEvent.setup();
    renderLetsMeshMeshcorePanel();

    const topic = screen.getByLabelText<HTMLInputElement>(/^Topic Prefix$/i);
    await user.clear(topic);
    await user.type(topic, 'meshcore/den');
    fireEvent.blur(topic);

    expect(topic.value).toBe('meshcore/DEN');
    expect(screen.getByRole('combobox', { name: 'Network Preset' })).toHaveValue('letsmesh');
  });

  it('disables Connect and flags an invalid IATA topic prefix', async () => {
    const user = userEvent.setup();
    renderLetsMeshMeshcorePanel();

    const topic = screen.getByLabelText<HTMLInputElement>(/^Topic Prefix$/i);
    await user.clear(topic);
    await user.type(topic, 'meshcore/zzzz');

    expect(topic).toHaveAttribute('aria-invalid', 'true');
    const mqttCard = screen.getByText('MQTT Connection').closest('.bg-deep-black');
    const connectBtn = within(mqttCard as HTMLElement).getByRole('button', { name: 'Connect' });
    expect(connectBtn).toBeDisabled();
  });

  it('offers MeshCore.CA Primary/Backup broker toggle that switches the server', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:coloradoMqttRegionAck-v1', '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'MeshCore.CA' }));
    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe('mqtt1.meshcore.ca');

    const brokerGroup = screen.getByRole('group', { name: 'MeshCore.CA broker' });
    await user.click(within(brokerGroup).getByRole('button', { name: 'Backup' }));
    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe('mqtt2.meshcore.ca');
  });

  it('does not apply Colorado preset fields when confirm is cancelled', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:coloradoMqttRegionAck-v1', '1');
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt-us-v1.letsmesh.net',
        topicPrefix: 'meshcore/test',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        username: '',
        password: '',
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

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

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: 'Colorado Mesh' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('letsmesh');
    expect(screen.getByLabelText(/^Server$/i)).toHaveValue('mqtt-us-v1.letsmesh.net');
    // The controlled select must snap back to the current preset after a cancelled confirm
    // (re-query: cancelling remounts the select so the original node is detached).
    expect(screen.getByRole('combobox', { name: 'Network Preset' })).toHaveValue('letsmesh');
  });

  it('shows one-time Colorado region gate and switches to LetsMesh on cancel', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        topicPrefix: 'meshcore/DEN',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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

    const dialog = await screen.findByRole('alertdialog', { name: 'Colorado Mesh MQTT' });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Switch to LetsMesh' }));
    expect(localStorage.getItem('mesh-client:coloradoMqttRegionAck-v1')).toBe('1');
    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('letsmesh');
    expect(
      screen.queryByRole('alertdialog', { name: 'Colorado Mesh MQTT' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Colorado Mesh when the region gate is acknowledged with Stay', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        topicPrefix: 'meshcore/DEN',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

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

    const dialog = await screen.findByRole('alertdialog', { name: 'Colorado Mesh MQTT' });
    await user.click(within(dialog).getByRole('button', { name: 'I am in Colorado' }));
    expect(localStorage.getItem('mesh-client:coloradoMqttRegionAck-v1')).toBe('1');
    expect(localStorage.getItem('mesh-client:mqttPreset:meshcore')).toBe('coloradomesh');
    expect(screen.getByLabelText(/^Server$/i)).toHaveValue('mqtt.meshcore.coloradomesh.org');
    expect(
      screen.queryByRole('alertdialog', { name: 'Colorado Mesh MQTT' }),
    ).not.toBeInTheDocument();
  });

  it('shows Colorado region gate even when MQTT is already connected', async () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'coloradomesh');
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        server: 'mqtt.meshcore.coloradomesh.org',
        topicPrefix: 'meshcore/DEN',
        port: 443,
        useWebSocket: true,
        tlsEnabled: true,
        wsPath: '/ws',
        keepalive: 30,
        password: '',
        autoLaunch: true,
      }),
    );
    localStorage.setItem('mesh-client:migrated:meshcore-letsmesh-default-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-v1', '1');
    localStorage.setItem('mesh-client:migrated:colorado-mesh-port-443-v1', '1');
    localStorage.setItem('mesh-client:migrated:meshcore-topic-iata-shape-v1', '1');

    render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="connected"
        protocol="meshcore"
      />,
    );

    expect(
      await screen.findByRole('alertdialog', { name: 'Colorado Mesh MQTT' }),
    ).toBeInTheDocument();
  });
});

describe('ConnectionPanel BLE error humanization', () => {
  afterEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.startGattScanning).mockReset();
  });

  it('shows Windows handshake guidance for MeshCore BLE handshake timeout/disconnect', async () => {
    const user = userEvent.setup();
    const { spy: consoleWarnSpy, restore } = mockConsoleWarn();
    const { restore: restorePlatform } = mockNobleBlePlatform('win32');
    vi.mocked(window.electronAPI.startGattScanning).mockRejectedValueOnce(
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
    restore();
    restorePlatform();
  });

  it('renders object-shaped BLE errors as JSON instead of [object Object]', async () => {
    const user = userEvent.setup();
    const { spy: consoleWarnSpy, restore } = mockConsoleWarn();
    const { restore: restorePlatform } = mockNobleBlePlatform('win32');
    vi.mocked(window.electronAPI.startGattScanning).mockRejectedValueOnce({
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
    restore();
    restorePlatform();
  });

  it('shows Windows adapter guidance when BLE adapter is unavailable', async () => {
    const user = userEvent.setup();
    const { spy: consoleWarnSpy, restore } = mockConsoleWarn();
    const { restore: restorePlatform } = mockNobleBlePlatform('win32');
    vi.mocked(window.electronAPI.startGattScanning).mockRejectedValueOnce(
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
    restore();
    restorePlatform();
  });
});

describe('ConnectionPanel Linux BLE auto-connect', () => {
  function mockLinuxUserAgent(): ReturnType<typeof vi.spyOn> {
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    return userAgentSpy;
  }

  it('does not mount-auto-connect BLE when last connection is saved (coordinator owns cold-start)', async () => {
    const userAgentSpy = mockLinuxUserAgent();
    const bleId = 'linux-ble-device';
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(lastConnKey, JSON.stringify({ type: 'ble', bleDeviceId: bleId }));
    const onAutoConnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.startGattScanning).mockClear();

    try {
      render(
        <ConnectionPanel
          state={disconnectedState}
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={onAutoConnect}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Radio Connection')).toBeInTheDocument();
      });
      expect(onAutoConnect).not.toHaveBeenCalled();
      expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem(lastConnKey);
      userAgentSpy.mockRestore();
    }
  });

  it('does not start GATT scan for meshcore on Linux mount with saved BLE connection', async () => {
    const userAgentSpy = mockLinuxUserAgent();
    const lastConnKey = 'mesh-client:lastConnection:meshcore';
    localStorage.setItem(lastConnKey, JSON.stringify({ type: 'ble', bleDeviceId: 'linux-mc-ble' }));
    vi.mocked(window.electronAPI.startGattScanning).mockClear();

    try {
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

      await waitFor(() => {
        expect(screen.getByText('Radio Connection')).toBeInTheDocument();
      });
      expect(window.electronAPI.startGattScanning).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem(lastConnKey);
      userAgentSpy.mockRestore();
    }
  });
});

describe('ConnectionPanel Linux BLE path', () => {
  let discovered: ((device: GattBleDevice) => void) | undefined;

  beforeEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.startGattScanning).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.bluetoothGetInfo).mockResolvedValue('Paired: yes');
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      discovered = cb;
      return () => {};
    });
  });

  async function selectBleRadio(user: ReturnType<typeof userEvent.setup>, deviceId: string) {
    act(() => discovered?.({ deviceId, deviceName: 'Test Radio' }));
    await user.click(
      await screen.findByRole('button', {
        name: (name) => name.startsWith(`Test Radio ${deviceId}`),
      }),
    );
  }

  it('keeps MeshCore PIN guidance in Linux BLE pairing-related errors', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.startGattScanning).mockClear();
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
    await selectBleRadio(user, 'bad-device');

    expect(await screen.findByText(/Bluetooth Companion mode/i)).toBeInTheDocument();
    expect(screen.getByText(/paired with your computer using a PIN/i)).toBeInTheDocument();
    userAgentSpy.mockRestore();
  });

  it('clears remembered MeshCore BLE selection after Linux missing-services failure', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    const lastConnKey = 'mesh-client:lastConnection:meshcore';
    const lastBleKey = 'mesh-client:lastBleDevice:meshcore';
    localStorage.setItem(lastConnKey, JSON.stringify({ type: 'ble', bleDeviceId: 'bad-device' }));
    localStorage.setItem(lastBleKey, 'bad-device');
    const onConnect = vi.fn().mockRejectedValue(new Error('Could not find all requested services'));

    try {
      await withMockedConsoleWarn(async () => {
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
        await selectBleRadio(user, 'bad-device');

        await waitFor(() => {
          expect(onConnect).toHaveBeenCalledWith('ble', undefined, 'bad-device');
          expect(localStorage.getItem(lastConnKey)).toBeNull();
          expect(localStorage.getItem(lastBleKey)).toBeNull();
        });
      });
    } finally {
      localStorage.removeItem(lastConnKey);
      localStorage.removeItem(lastBleKey);
      userAgentSpy.mockRestore();
    }
  });

  it('clears remembered MeshCore BLE selection after Linux missing-services reconnect failure', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    const lastConnKey = 'mesh-client:lastConnection:meshcore';
    const lastBleKey = 'mesh-client:lastBleDevice:meshcore';
    localStorage.setItem(lastConnKey, JSON.stringify({ type: 'ble', bleDeviceId: 'bad-device' }));
    localStorage.setItem(lastBleKey, 'bad-device');
    const onConnect = vi.fn().mockRejectedValue(new Error('Could not find all requested services'));

    try {
      await withMockedConsoleWarn(async () => {
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

        await waitFor(() => {
          expect(screen.getByRole('button', { name: /^Reconnect$/i })).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: /^Reconnect$/i }));

        await waitFor(() => {
          expect(onConnect).toHaveBeenCalledWith('ble', undefined, 'bad-device');
          expect(localStorage.getItem(lastConnKey)).toBeNull();
          expect(localStorage.getItem(lastBleKey)).toBeNull();
        });
      });
    } finally {
      localStorage.removeItem(lastConnKey);
      localStorage.removeItem(lastBleKey);
      userAgentSpy.mockRestore();
    }
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
  protocol: MeshProtocol = 'meshtastic',
) {
  return render(
    <ConnectionPanel
      state={configuredState}
      onConnect={vi.fn().mockResolvedValue(undefined)}
      onAutoConnect={vi.fn().mockResolvedValue(undefined)}
      onDisconnect={vi.fn().mockResolvedValue(undefined)}
      mqttStatus="disconnected"
      protocol={protocol}
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
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ConnectionPanel status i18n and pulse', () => {
  it('translates radio status, connection type, and docs link when connected', () => {
    renderWithFirmware();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('Bluetooth')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Docs ↗' })).toHaveAttribute(
      'href',
      'https://charlottemeshtastic.github.io/mesh-client/troubleshooting/',
    );
    expect(screen.queryByText('configured')).not.toBeInTheDocument();
    expect(screen.queryByText('ble')).not.toBeInTheDocument();
  });

  it.each([
    ['meshtastic', 'https://charlottemeshtastic.github.io/mesh-client/troubleshooting/'],
    ['meshcore', 'https://charlottemeshtastic.github.io/mesh-client/troubleshooting-meshcore/'],
  ] as const)('links %s Docs to its troubleshooting page on the docs site', (protocol, href) => {
    renderWithFirmware(undefined, undefined, protocol);
    expect(screen.getByRole('link', { name: 'Docs ↗' })).toHaveAttribute('href', href);
  });

  it('pulses the reconnecting radio status dot, not the status text', () => {
    render(
      <ConnectionPanel
        state={{ ...configuredState, status: 'reconnecting' }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    const statusText = screen.getByText('Reconnecting');
    expect(statusText).not.toHaveClass('animate-pulse');
    expect(statusText.previousElementSibling).toHaveClass('animate-pulse');
  });

  it('pulses the MQTT connecting dot, not the status text', () => {
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
    const tiles = screen.getByRole('group', { name: 'Link status' });
    const statusText = within(tiles).getByText('Connecting');
    expect(statusText).not.toHaveClass('animate-pulse');
    expect(statusText.parentElement).not.toHaveClass('animate-pulse');
    expect(statusText.previousElementSibling).toHaveClass('bg-status-warning', 'animate-pulse');
  });

  it('shows an unexpected MQTT drop as an error, like the status bar', () => {
    const renderWith = (mqttConnectionLoss: boolean) => (
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        mqttConnectionLoss={mqttConnectionLoss}
        protocol="meshtastic"
      />
    );
    const { rerender } = render(renderWith(true));
    const tiles = screen.getByRole('group', { name: 'Link status' });
    expect(within(tiles).getByText('Error')).toBeInTheDocument();
    // A disconnect the user asked for stays neutral.
    rerender(renderWith(false));
    expect(within(tiles).queryByText('Error')).toBeNull();
  });

  it('translates last-connection transport type', () => {
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({ type: 'http', httpAddress: '192.168.1.20' }),
    );
    try {
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
      const lastCard = screen
        .getByRole('button', { name: /^Reconnect$/i })
        .closest('.bg-deep-black');
      expect(lastCard).toBeTruthy();
      expect(within(lastCard as HTMLElement).getByText('WiFi/HTTP')).toBeInTheDocument();
      expect(within(lastCard as HTMLElement).queryByText(/^http$/i)).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem(lastConnKey);
    }
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

  it("selecting Liam's preset populates liamcottle.net credentials", async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: "Liam's" }));

    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe(
      'mqtt.meshtastic.liamcottle.net',
    );
    expect(screen.getByLabelText<HTMLInputElement>(/^Port$/i).value).toBe('1883');
    expect(screen.getByLabelText<HTMLInputElement>(/^Username$/i).value).toBe('uplink');
  });

  it("shows uplink-only warning when Liam's preset is active", async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    await user.selectOptions(select, within(select).getByRole('option', { name: "Liam's" }));

    expect(screen.getByText(/uplink-only/i)).toBeInTheDocument();
  });

  it('selecting the Official preset applies official 1883 fields and hides the uplink warning', async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const select = screen.getByRole('combobox', { name: 'Network Preset' });
    // First activate Liam's, then switch back to Official
    await user.selectOptions(select, within(select).getByRole('option', { name: "Liam's" }));
    await user.selectOptions(select, within(select).getByRole('option', { name: 'Official' }));

    expect(screen.getByLabelText<HTMLInputElement>(/^Server$/i).value).toBe('mqtt.meshtastic.org');
    expect(screen.getByLabelText<HTMLInputElement>(/^Port$/i).value).toBe('1883');
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

describe('ConnectionPanel connect views', () => {
  it('shows auto-reconnect banner while status is reconnecting', () => {
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
        protocol="meshcore"
      />,
    );
    expect(screen.getByText(/Auto-reconnect in progress/i)).toBeInTheDocument();
  });

  it('shows the connecting view while RF connect is in progress', async () => {
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

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    resolveConnect();
    await waitFor(() => {
      expect(onConnect).toHaveBeenCalled();
    });
  });

  it('returns to the disconnected view after a connect failure', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockRejectedValue(new Error('Connection refused'));
    await withMockedConsoleWarn(async () => {
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
      await user.click(
        within(radioCard as HTMLElement).getByRole('radio', { name: /wifi\/http/i }),
      );
      const hostInput = within(radioCard as HTMLElement).getByLabelText(/device address/i);
      fireEvent.change(hostInput, { target: { value: '192.168.1.10' } });
      await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

      await waitFor(() => {
        expect(
          within(
            screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!,
          ).getByRole('button', { name: 'Connect' }),
        ).toBeInTheDocument();
      });
      expect(screen.getByText('Radio Connection')).toBeInTheDocument();
    });
  });

  it('connects via TCP with typed address', async () => {
    const user = userEvent.setup();
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
    await user.click(within(radioCard as HTMLElement).getByRole('radio', { name: /wifi\/tcp/i }));
    const hostInput = within(radioCard as HTMLElement).getByLabelText(/device address/i);
    fireEvent.change(hostInput, { target: { value: '192.168.200.4' } });
    await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith('tcp', '192.168.200.4');
    });
  });

  it('shows the serial port picker while a USB connect waits for a port', async () => {
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

    expect(onConnect).toHaveBeenCalledWith('serial');
    expect(capturedCb).toBeDefined();

    act(() => {
      flushSync(() => {
        capturedCb!([
          { portId: 'port-1', displayName: 'Meshtastic USB', portName: '/dev/ttyUSB0' },
        ]);
      });
    });

    expect(screen.getByText('Select Serial Port')).toBeInTheDocument();
  });

  it('returns to the disconnected view after a failed reconnect from the last-connection card', async () => {
    const user = userEvent.setup();
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({ type: 'http', httpAddress: '192.168.1.10' }),
    );
    const onConnect = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
      await withMockedConsoleWarn(async () => {
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
          expect(
            within(
              screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!,
            ).getByRole('button', { name: 'Connect' }),
          ).toBeInTheDocument();
        });
        expect(onConnect).toHaveBeenCalledWith('http', '192.168.1.10');
        expect(screen.getByText('Radio Connection')).toBeInTheDocument();
      });
    } finally {
      localStorage.removeItem(lastConnKey);
    }
  });
});

describe('ConnectionPanel auto-reconnect banner leftover', () => {
  afterEach(() => {
    localStorage.removeItem('mesh-client:lastBleDevice:meshtastic');
    localStorage.removeItem('mesh-client:lastBleDevice:meshcore');
    localStorage.removeItem('mesh-client:protocol');
    resetNobleBleConnectMutexForTests();
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
  });

  function seedDualRadioPrimaryMeshtastic(): ReturnType<typeof mockMacNoblePlatform> {
    const platform = mockMacNoblePlatform();
    localStorage.setItem('mesh-client:lastBleDevice:meshtastic', 'mt-peripheral');
    localStorage.setItem('mesh-client:lastBleDevice:meshcore', 'mc-peripheral');
    localStorage.setItem('mesh-client:protocol', 'meshtastic');
    initNobleBleDualRadioStartup();
    return platform;
  }

  it.each(['meshcore', 'meshtastic'] as const)(
    'does not show leftover auto-reconnect banner on configured %s radio',
    (protocol) => {
      const { restore } = seedDualRadioPrimaryMeshtastic();
      try {
        render(
          <ConnectionPanel
            state={{
              ...configuredState,
              connectionType: 'ble',
            }}
            onConnect={vi.fn().mockResolvedValue(undefined)}
            onAutoConnect={vi.fn().mockResolvedValue(undefined)}
            onDisconnect={vi.fn().mockResolvedValue(undefined)}
            mqttStatus="connected"
            protocol={protocol}
          />,
        );
        expect(screen.queryByText(/Auto-reconnect in progress/i)).not.toBeInTheDocument();
        expect(screen.getByText('Radio Connection')).toBeInTheDocument();
      } finally {
        restore();
      }
    },
  );

  it('does not show dual-radio wait notice while primary auto-connect is in flight', () => {
    // showNobleBleWaitNotice is intentionally false — dual-radio ordering still uses
    // awaitNobleBlePrimaryAutoConnectSettled in the RF auto-connect coordinator, but the
    // ConnectionPanel no longer renders a Noble-wait stage banner.
    const { restore } = seedDualRadioPrimaryMeshtastic();
    try {
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
      expect(screen.queryByText(/Auto-reconnect in progress/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Waiting for Meshtastic Bluetooth/i)).not.toBeInTheDocument();
      expect(screen.getByText('Radio Connection')).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe('ConnectionPanel BLE noble manual connect', () => {
  it('starts noble scan on manual Connect even when a last BLE device is saved', async () => {
    const user = userEvent.setup();
    const { restore } = mockMacNoblePlatform();
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({ type: 'ble', bleDeviceId: 'previously-paired-radio' }),
    );
    const onAutoConnect = vi.fn().mockResolvedValue(undefined);
    const onConnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.startGattScanning).mockClear();

    try {
      render(
        <ConnectionPanel
          state={disconnectedState}
          onConnect={onConnect}
          onAutoConnect={onAutoConnect}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Connection Type' })).toBeInTheDocument();
      });
      // Cold-start BLE is owned by ProtocolAutoConnectCoordinator — panel must not mount-connect.
      expect(onAutoConnect).not.toHaveBeenCalled();

      vi.mocked(window.electronAPI.startGattScanning).mockClear();

      const connectionField = screen
        .getByRole('radiogroup', { name: 'Connection Type' })
        .closest('fieldset')?.parentElement;
      expect(connectionField).toBeTruthy();
      await user.click(within(connectionField!).getByRole('radio', { name: /Bluetooth/i }));
      await user.click(within(connectionField!).getByRole('button', { name: /^Connect$/i }));

      await waitFor(() => {
        expect(window.electronAPI.startGattScanning).toHaveBeenCalledWith('meshtastic');
      });
      expect(onConnect).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem(lastConnKey);
      restore();
    }
  });
});

describe('ConnectionPanel ProtocolAutoConnectCoordinator cancel', () => {
  it('cancels ProtocolAutoConnectCoordinator when user clicks Reconnect with a pending last connection', async () => {
    const user = userEvent.setup();
    const lastConnKey = 'mesh-client:lastConnection:meshtastic';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({ type: 'tcp', httpAddress: '192.168.1.50:4403' }),
    );
    const gate = await import('../lib/protocolRfAutoConnectGate');
    const cancelSpy = vi.spyOn(gate, 'cancelProtocolRfAutoConnect');
    const onConnect = vi.fn().mockResolvedValue(undefined);

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

      await user.click(await screen.findByRole('button', { name: /^Reconnect$/i }));

      expect(cancelSpy).toHaveBeenCalledWith('meshtastic');
      await waitFor(() => {
        expect(onConnect).toHaveBeenCalledWith('tcp', '192.168.1.50:4403');
      });
      const cancelOrder = cancelSpy.mock.invocationCallOrder[0];
      const connectOrder = onConnect.mock.invocationCallOrder[0];
      if (cancelOrder === undefined || connectOrder === undefined) {
        throw new Error('expected cancelProtocolRfAutoConnect and onConnect call order');
      }
      expect(cancelOrder).toBeLessThan(connectOrder);
    } finally {
      cancelSpy.mockRestore();
      localStorage.removeItem(lastConnKey);
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
    const onConnect = vi.fn().mockResolvedValue(undefined);
    await withMockedConsoleWarn(async () => {
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
    });
  });

  it.each([
    ['0', 'localhost:5000'],
    ['65536', 'localhost:5000'],
    ['abc', 'localhost:5000'],
  ])('falls back to port 5000 for invalid port %s', async (badPort, expectedAddress) => {
    const user = userEvent.setup();
    const onConnect = vi.fn().mockResolvedValue(undefined);
    await withMockedConsoleWarn(async () => {
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
    });
  });
});

describe('ConnectionPanel Meshtastic MQTT autoLaunch persistence', () => {
  function renderMeshtasticMqttPanel() {
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

  it('persists autoLaunch immediately when toggled', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:mqttSettings', JSON.stringify({ autoLaunch: false }));
    renderMeshtasticMqttPanel();

    await user.click(screen.getByRole('checkbox', { name: 'Auto-connect on application start' }));

    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings') ?? '{}').autoLaunch).toBe(
      true,
    );
  });
});

describe('ConnectionPanel MQTT channel PSKs', () => {
  const KEY_A = '1PG7OiApB1nwvP+rz05pAQ==';
  const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';
  const INVALID_LENGTH_PSK = btoa(String.fromCharCode(...new Uint8Array(20).fill(2)));

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

  it('shows invalid length warning after blur', async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, INVALID_LENGTH_PSK);
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(
        screen.getByText(/Each key must decode to 16 bytes \(AES-128\) or 32 bytes \(AES-256\)/),
      ).toBeInTheDocument();
    });
  });

  it('shows invalid base64 warning after blur', async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, 'not!!!base64');
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(screen.getByText(/Invalid base64 on a channel PSK line/)).toBeInTheDocument();
    });
  });

  it('clears validation warning when draft is edited', async () => {
    const user = userEvent.setup();
    renderMeshtasticMqtt();

    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, INVALID_LENGTH_PSK);
    fireEvent.blur(textarea);
    await waitFor(() => {
      expect(screen.getByText(/Each key must decode to 16 bytes/)).toBeInTheDocument();
    });

    await user.type(textarea, 'x');
    await waitFor(() => {
      expect(screen.queryByText(/Each key must decode to 16 bytes/)).not.toBeInTheDocument();
    });
  });

  it('shows MQTT-only @index hint when no radio is configured and no @index lines', () => {
    renderMeshtasticMqtt();

    expect(
      screen.getByText(/Without a radio connected, inbound MQTT messages route to chat tabs/i),
    ).toBeInTheDocument();
  });

  it('hides MQTT-only @index hint when draft includes ChannelName@index', async () => {
    renderMeshtasticMqtt();

    const textarea = document.getElementById('mqtt-channel-psks') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `LongFast@1=${KEY_B}` } });

    await waitFor(() => {
      expect(
        screen.queryByText(/Without a radio connected, inbound MQTT messages route to chat tabs/i),
      ).not.toBeInTheDocument();
    });
  });

  it('hides MQTT-only @index hint when radio is configured', () => {
    render(
      <ConnectionPanel
        state={configuredState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );

    expect(
      screen.queryByText(/Without a radio connected, inbound MQTT messages route to chat tabs/i),
    ).not.toBeInTheDocument();
  });
});

describe('ConnectionPanel LetsMesh username sync', () => {
  const PUB_HEX = 'a'.repeat(64);

  function renderMeshcoreLetsMesh() {
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
      />,
    );
  }

  it('shows the MQTT client key with a copy button once the identity has a key pair', async () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(
      MESHCORE_IDENTITY_STORAGE_KEY,
      JSON.stringify({ public_key: PUB_HEX, private_key: 'a'.repeat(128) }),
    );
    try {
      renderMeshcoreLetsMesh();
      const copy = await screen.findByRole('button', { name: 'Copy client key' });
      const field = copy.parentElement;
      expect(field).toHaveTextContent(PUB_HEX.toUpperCase().slice(0, 16));
      expect(field).toHaveTextContent(PUB_HEX.toUpperCase().slice(-20));
    } finally {
      localStorage.removeItem('mesh-client:mqttPreset:meshcore');
      localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
    }
  });

  it('populates username from identity on mount and after debounced identity updates', async () => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
    localStorage.setItem(MESHCORE_IDENTITY_STORAGE_KEY, JSON.stringify({ public_key: PUB_HEX }));
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    try {
      renderMeshcoreLetsMesh();

      const usernameInput = await screen.findByLabelText<HTMLInputElement>(/^Username$/i);
      expect(usernameInput.value).toBe(`v1_${PUB_HEX.toUpperCase()}`);

      const callsBeforeBurst = getItemSpy.mock.calls.filter(
        ([key]) => key === MESHCORE_IDENTITY_STORAGE_KEY,
      ).length;

      act(() => {
        window.dispatchEvent(new Event('meshclient:meshcoreIdentityUpdated'));
        window.dispatchEvent(new Event('meshclient:meshcoreIdentityUpdated'));
        window.dispatchEvent(new Event('meshclient:meshcoreIdentityUpdated'));
      });

      await waitFor(
        () => {
          const callsAfterBurst = getItemSpy.mock.calls.filter(
            ([key]) => key === MESHCORE_IDENTITY_STORAGE_KEY,
          ).length;
          expect(callsAfterBurst - callsBeforeBurst).toBeLessThanOrEqual(2);
        },
        { timeout: 500 },
      );
      expect(usernameInput.value).toBe(`v1_${PUB_HEX.toUpperCase()}`);
    } finally {
      localStorage.removeItem('mesh-client:mqttPreset:meshcore');
      localStorage.removeItem(MESHCORE_IDENTITY_STORAGE_KEY);
      getItemSpy.mockRestore();
    }
  });
});

describe('ConnectionPanel device picker sort', () => {
  it('sorts BLE devices by RSSI then Name', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );

    const discovered = { cb: null as ((device: GattBleDevice) => void) | null };
    vi.mocked(window.electronAPI.startGattScanning).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      discovered.cb = cb;
      return () => {};
    });

    const onConnect = vi.fn(
      () =>
        new Promise<void>(() => {
          /* leave connecting so picker stays open */
        }),
    );

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

    await waitFor(() => {
      expect(discovered.cb).toBeTruthy();
    });
    act(() => {
      for (const device of [
        { deviceId: 'id-z', deviceName: 'Zulu', rssi: -90 },
        { deviceId: 'id-a', deviceName: 'Alpha', rssi: -40 },
        { deviceId: 'id-m', deviceName: 'Mid', rssi: -70 },
        { deviceId: 'id-n', deviceName: 'NoRssi' },
      ]) {
        discovered.cb?.(device);
      }
    });

    const names = () =>
      screen
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label') ?? '')
        .filter((label) => /Alpha|Mid|Zulu|NoRssi/.test(label) && label.includes('id-'))
        .map((label) => label.split(' ')[0]);

    await waitFor(() => {
      expect(names()).toEqual(['Alpha', 'Mid', 'Zulu', 'NoRssi']);
    });

    await user.click(screen.getByRole('button', { name: 'Sort by Name, A to Z' }));
    expect(names()).toEqual(['Alpha', 'Mid', 'NoRssi', 'Zulu']);

    await user.click(screen.getByRole('button', { name: 'Sort by Name, A to Z' }));
    expect(names()).toEqual(['Zulu', 'NoRssi', 'Mid', 'Alpha']);

    userAgentSpy.mockRestore();
  });

  it('sorts serial ports A–Z by default and reverses on Name click', async () => {
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

    act(() => {
      flushSync(() => {
        capturedCb!([
          { portId: 'z', displayName: 'Zulu USB', portName: '/dev/ttyUSB1' },
          { portId: 'a', displayName: 'Alpha USB', portName: '/dev/ttyUSB0' },
        ]);
      });
    });

    const names = () =>
      screen
        .getAllByRole('button')
        .map((el) => el.getAttribute('aria-label') ?? '')
        .filter((label) => label.includes('USB'))
        .map((label) => (label.includes('Alpha') ? 'Alpha USB' : 'Zulu USB'));

    expect(screen.getByText('Select Serial Port')).toBeInTheDocument();
    expect(names()).toEqual(['Alpha USB', 'Zulu USB']);

    await user.click(screen.getByRole('button', { name: 'Sort by Name, A to Z' }));
    expect(names()).toEqual(['Zulu USB', 'Alpha USB']);
  });
});

describe('ConnectionPanel BLE MAC identity', () => {
  const darwinUuid = 'eccf2847e1fd3f5f0811064db1639a3d';
  const lastConnKey = 'mesh-client:lastConnection:meshtastic';

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.startGattScanning).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows formatted MAC in the picker when GATT provides address for a CoreBluetooth UUID', async () => {
    const user = userEvent.setup();
    const { restore } = mockMacNoblePlatform();
    let capturedCb:
      | ((device: {
          deviceId: string;
          deviceName: string;
          rssi?: number | null;
          address?: string | null;
        }) => void)
      | undefined;
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    const onConnect = vi.fn(
      () =>
        new Promise<void>(() => {
          /* leave connecting so picker stays open */
        }),
    );

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

      const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
      expect(radioCard).toBeTruthy();
      await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

      await waitFor(() => {
        expect(capturedCb).toBeTruthy();
      });
      act(() => {
        capturedCb?.({
          deviceId: darwinUuid,
          deviceName: 'MeshCore',
          address: 'aa-bb-cc-dd-ee-ff',
          rssi: -55,
        });
      });

      await waitFor(() => {
        expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
      });
      expect(screen.queryByText(darwinUuid)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /MeshCore aa:bb:cc:dd:ee:ff/ }),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('shows formatted MAC in the MeshCore BLE picker when address is provided', async () => {
    const user = userEvent.setup();
    const { restore } = mockMacNoblePlatform();
    let capturedCb:
      | ((device: {
          deviceId: string;
          deviceName: string;
          rssi?: number | null;
          address?: string | null;
        }) => void)
      | undefined;
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    const onConnect = vi.fn(
      () =>
        new Promise<void>(() => {
          /* leave connecting so picker stays open */
        }),
    );

    try {
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

      await waitFor(() => {
        expect(capturedCb).toBeTruthy();
      });
      act(() => {
        capturedCb?.({
          deviceId: darwinUuid,
          deviceName: 'MeshCore-NV0N',
          address: 'ac:a7:04:00:d6:f1',
          rssi: -62,
        });
      });

      await waitFor(() => {
        expect(screen.getByText('ac:a7:04:00:d6:f1')).toBeInTheDocument();
      });
      expect(screen.queryByText(darwinUuid)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('clears remembered MeshCore BLE selection after missing-services connect failure', async () => {
    const user = userEvent.setup();
    const { restore } = mockMacNoblePlatform();
    const lastConnKey = 'mesh-client:lastConnection:meshcore';
    const lastBleKey = 'mesh-client:lastBleDevice:meshcore';
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({
        type: 'ble',
        bleDeviceId: darwinUuid,
        bleDeviceName: 'MeshCore-NV0N',
        bleMac: 'ac:a7:04:00:d6:f1',
      }),
    );
    localStorage.setItem(lastBleKey, darwinUuid);
    let capturedCb:
      | ((device: {
          deviceId: string;
          deviceName: string;
          rssi?: number | null;
          address?: string | null;
        }) => void)
      | undefined;
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      capturedCb = cb;
      return () => {};
    });
    const onConnect = vi
      .fn()
      .mockRejectedValue(new Error('Failed to find required BLE characteristics'));

    try {
      await withMockedConsoleWarn(async () => {
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

        expect(screen.getByRole('button', { name: /^Reconnect$/i })).toBeInTheDocument();
        const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
        expect(radioCard).toBeTruthy();
        await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

        await waitFor(() => {
          expect(capturedCb).toBeTruthy();
        });
        act(() => {
          capturedCb?.({
            deviceId: darwinUuid,
            deviceName: 'MeshCore-NV0N',
            address: 'ac:a7:04:00:d6:f1',
            rssi: -62,
          });
        });

        await user.click(
          await screen.findByRole('button', { name: /MeshCore-NV0N ac:a7:04:00:d6:f1/i }),
        );

        await waitFor(() => {
          expect(localStorage.getItem(lastConnKey)).toBeNull();
          expect(localStorage.getItem(lastBleKey)).toBeNull();
        });
        await waitFor(() => {
          expect(screen.queryByRole('button', { name: /^Reconnect$/i })).not.toBeInTheDocument();
        });
      });
    } finally {
      localStorage.removeItem(lastConnKey);
      localStorage.removeItem(lastBleKey);
      restore();
    }
  });

  it('shows Bluetooth MAC on Last Connection and the connected Radio Connection card', () => {
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({
        type: 'ble',
        bleDeviceId: darwinUuid,
        bleDeviceName: 'MeshCore',
        bleMac: 'aa:bb:cc:dd:ee:ff',
      }),
    );

    try {
      const { unmount } = render(
        <ConnectionPanel
          state={disconnectedState}
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );
      expect(screen.getByText('MeshCore')).toBeInTheDocument();
      expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
      unmount();

      render(
        <ConnectionPanel
          state={configuredState}
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );
      expect(screen.getByText('Bluetooth MAC')).toBeInTheDocument();
      expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
    } finally {
      localStorage.removeItem(lastConnKey);
    }
  });

  it('labels a UUID-only last device as Bluetooth ID, not MAC', () => {
    localStorage.setItem(
      lastConnKey,
      JSON.stringify({
        type: 'ble',
        bleDeviceId: darwinUuid,
        bleDeviceName: 'MeshCore',
      }),
    );

    try {
      render(
        <ConnectionPanel
          state={configuredState}
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="disconnected"
          protocol="meshtastic"
        />,
      );
      expect(screen.getByText('Bluetooth ID')).toBeInTheDocument();
      expect(screen.getByText(darwinUuid)).toBeInTheDocument();
      expect(screen.queryByText('Bluetooth MAC')).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem(lastConnKey);
    }
  });

  it('clears reconnect card when BLE selection-cleared event is emitted', async () => {
    const lastConnKey = 'mesh-client:lastConnection:meshcore';
    localStorage.setItem(lastConnKey, JSON.stringify({ type: 'ble', bleDeviceId: darwinUuid }));

    try {
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

      expect(screen.getByRole('button', { name: /^Reconnect$/i })).toBeInTheDocument();
      window.dispatchEvent(
        new CustomEvent('mesh-client:ble-selection-cleared', { detail: { protocol: 'meshcore' } }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /^Reconnect$/i })).not.toBeInTheDocument();
      });
    } finally {
      localStorage.removeItem(lastConnKey);
    }
  });

  it('formats a compact 12-hex picker deviceId as a colon MAC', async () => {
    const user = userEvent.setup();
    const userAgentSpy = vi.spyOn(window.navigator, 'userAgent', 'get');
    userAgentSpy.mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );

    const discovered = { cb: null as ((device: GattBleDevice) => void) | null };
    vi.mocked(window.electronAPI.startGattScanning).mockResolvedValue({ ok: true });
    vi.mocked(window.electronAPI.onGattDeviceDiscovered).mockImplementation((cb) => {
      discovered.cb = cb;
      return () => {};
    });
    const onConnect = vi.fn(
      () =>
        new Promise<void>(() => {
          /* leave connecting so picker stays open */
        }),
    );

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

      const radioCard = screen.getByText('Radio Connection').closest('.bg-deep-black');
      expect(radioCard).toBeTruthy();
      await user.click(within(radioCard as HTMLElement).getByRole('button', { name: 'Connect' }));

      await waitFor(() => {
        expect(discovered.cb).toBeTruthy();
      });
      act(() => discovered.cb?.({ deviceId: 'AABBCCDDEEFF', deviceName: 'MeshCore', rssi: -40 }));

      await waitFor(() => {
        expect(screen.getByText('aa:bb:cc:dd:ee:ff')).toBeInTheDocument();
      });
    } finally {
      userAgentSpy.mockRestore();
    }
  });
});

describe('ConnectionPanel link tiles and disconnect actions', () => {
  const tak = {
    running: true,
    port: 8087,
    serverError: false,
    clientLoss: false,
  };

  it('shows radio, MQTT and TAK tiles and opens the TAK panel', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(
      <ConnectionPanel
        state={configuredState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="connected"
        protocol="meshtastic"
        tak={{ ...tak, onOpen }}
      />,
    );
    const tiles = screen.getByRole('group', { name: 'Link status' });
    expect(within(tiles).getByText('Radio link')).toBeInTheDocument();
    expect(within(tiles).getByText('Configured')).toBeInTheDocument();
    expect(within(tiles).getByText('MQTT')).toBeInTheDocument();
    expect(within(tiles).getByText('Connected')).toBeInTheDocument();
    expect(within(tiles).getByText('Running')).toBeInTheDocument();
    expect(within(tiles).getByText('Port 8087')).toBeInTheDocument();

    await user.click(within(tiles).getByRole('button', { name: 'Open TAK' }));
    expect(onOpen).toHaveBeenCalledOnce();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers disconnecting radio and MQTT together from the split menu', async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.mqtt.disconnect).mockClear();
    render(
      <ConnectionPanel
        state={configuredState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={onDisconnect}
        mqttStatus="connected"
        protocol="meshtastic"
      />,
    );
    const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
    await user.click(within(radio).getByRole('button', { name: 'More disconnect options' }));
    await user.click(screen.getByRole('menuitem', { name: /Disconnect radio and MQTT/ }));

    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(window.electronAPI.mqtt.disconnect).toHaveBeenCalledWith('meshtastic');
  });

  it('uses a plain Disconnect button when MQTT is not connected', async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        state={configuredState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={onDisconnect}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    const radio = screen.getByText('Radio Connection').closest<HTMLElement>('.bg-deep-black')!;
    expect(
      within(radio).queryByRole('button', { name: 'More disconnect options' }),
    ).not.toBeInTheDocument();
    await user.click(within(radio).getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'has no Quit row of its own on %s: the header Disconnect & Quit covers it',
    (protocol) => {
      render(
        <ConnectionPanel
          state={disconnectedState}
          onConnect={vi.fn().mockResolvedValue(undefined)}
          onAutoConnect={vi.fn().mockResolvedValue(undefined)}
          onDisconnect={vi.fn().mockResolvedValue(undefined)}
          mqttStatus="connected"
          protocol={protocol}
        />,
      );
      expect(screen.queryByRole('button', { name: /quit/i })).toBeNull();
      expect(screen.queryByText('Closes Mesh Client.')).toBeNull();
    },
  );
});

describe('ConnectionPanel Meshtastic MQTT profiles', () => {
  const baseSettings = {
    server: 'mqtt.meshtastic.org',
    port: 1883,
    username: 'meshdev',
    password: 'large4cats',
    topicPrefix: 'msh/US',
    autoLaunch: false,
  };
  const profiles = [
    { ...baseSettings, id: 'nwi', name: 'NW Indiana', topicPrefix: 'msh/US/IN/NWI' },
    {
      ...baseSettings,
      id: 'chi',
      name: 'Chicago',
      server: 'mqtt.chimesh.org',
      topicPrefix: 'msh/US/IL/Chi',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mesh-client:mqttSettings', JSON.stringify(baseSettings));
    localStorage.setItem('mesh-client:mqttProfiles:meshtastic', JSON.stringify(profiles));
    vi.mocked(window.electronAPI.mqtt.connect).mockClear();
    vi.mocked(window.electronAPI.mqtt.updateTopicPrefix).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function renderPanel(mqttStatus: 'connected' | 'disconnected') {
    return render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus={mqttStatus}
        protocol="meshtastic"
      />,
    );
  }

  const presetSelect = () =>
    document.getElementById('conn-meshtastic-network-preset-select') as HTMLSelectElement;
  const liveProfileSelect = () => screen.getByRole('combobox', { name: 'Saved profile' });

  it('lists saved profiles and applies one without connecting', async () => {
    const user = userEvent.setup();
    renderPanel('disconnected');
    expect(screen.getByRole('option', { name: 'Saved: Chicago' })).toBeInTheDocument();

    await user.selectOptions(presetSelect(), 'profile:chi');
    expect((document.getElementById('mqtt-server') as HTMLInputElement).value).toBe(
      'mqtt.chimesh.org',
    );
    expect((document.getElementById('mqtt-topic-prefix') as HTMLInputElement).value).toBe(
      'msh/US/IL/Chi',
    );
    expect(presetSelect().value).toBe('profile:chi');
    expect(window.electronAPI.mqtt.connect).not.toHaveBeenCalled();
    expect(window.electronAPI.mqtt.updateTopicPrefix).not.toHaveBeenCalled();
  });

  it('re-subscribes with updateTopicPrefix when only the topic changes on a live session', async () => {
    const user = userEvent.setup();
    renderPanel('connected');
    expect(
      screen.getByRole('option', { name: 'Current settings (not saved)' }),
    ).toBeInTheDocument();
    await user.selectOptions(liveProfileSelect(), 'profile:nwi');
    expect(window.electronAPI.mqtt.updateTopicPrefix).toHaveBeenCalledWith({
      topicPrefix: 'msh/US/IN/NWI',
    });
    await waitFor(() => {
      expect((liveProfileSelect() as HTMLSelectElement).value).toBe('profile:nwi');
    });
    expect(window.electronAPI.mqtt.connect).not.toHaveBeenCalled();
    expect(screen.queryByText(/reconnect MQTT to use this profile/i)).toBeNull();
  });

  it('keeps settings unchanged when the live topic update is rejected', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.mqtt.updateTopicPrefix).mockRejectedValueOnce(
      new Error('topicPrefix too long'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPanel('connected');
    await user.selectOptions(liveProfileSelect(), 'profile:nwi');
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('updateTopicPrefix failed'));
    });
    expect((liveProfileSelect() as HTMLSelectElement).value).toBe('');
    warn.mockRestore();
  });

  it('ignores a topic update that resolves after MQTT disconnects', async () => {
    const user = userEvent.setup();
    let resolveUpdate: () => void = () => {};
    vi.mocked(window.electronAPI.mqtt.updateTopicPrefix).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const { rerender } = renderPanel('connected');
    await user.selectOptions(liveProfileSelect(), 'profile:nwi');
    rerender(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 0));
    expect((document.getElementById('mqtt-topic-prefix') as HTMLInputElement).value).toBe('msh/US');
  });

  it('ignores a prior-session topic update that resolves after a reconnect', async () => {
    const user = userEvent.setup();
    let resolveUpdate: () => void = () => {};
    vi.mocked(window.electronAPI.mqtt.updateTopicPrefix).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const panel = (mqttStatus: 'connected' | 'disconnected') => (
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus={mqttStatus}
        protocol="meshtastic"
      />
    );
    const { rerender } = render(panel('connected'));
    await user.selectOptions(liveProfileSelect(), 'profile:nwi');
    rerender(panel('disconnected'));
    rerender(panel('connected'));
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 0));
    expect((liveProfileSelect() as HTMLSelectElement).value).toBe('');
  });

  it('applies only the latest of overlapping topic updates', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mesh-client:mqttProfiles:meshtastic',
      JSON.stringify([
        ...profiles,
        { ...baseSettings, id: 'il', name: 'Illinois', topicPrefix: 'msh/US/IL' },
      ]),
    );
    let resolveFirst: () => void = () => {};
    vi.mocked(window.electronAPI.mqtt.updateTopicPrefix).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    renderPanel('connected');
    await user.selectOptions(liveProfileSelect(), 'profile:nwi');
    await user.selectOptions(liveProfileSelect(), 'profile:il');
    await waitFor(() => {
      expect((liveProfileSelect() as HTMLSelectElement).value).toBe('profile:il');
    });
    resolveFirst();
    await new Promise((r) => setTimeout(r, 0));
    expect((liveProfileSelect() as HTMLSelectElement).value).toBe('profile:il');
  });

  it('never sends a wildcard profile prefix to a live session', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mesh-client:mqttProfiles:meshtastic',
      JSON.stringify([{ ...baseSettings, id: 'wild', name: 'Wild', topicPrefix: 'msh/+/IN' }]),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderPanel('connected');
    await user.selectOptions(liveProfileSelect(), 'profile:wild');
    expect(window.electronAPI.mqtt.updateTopicPrefix).not.toHaveBeenCalled();
    expect((liveProfileSelect() as HTMLSelectElement).value).toBe('');
    warn.mockRestore();
  });

  it('disables the profile picker while MQTT is connecting', () => {
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
    expect(presetSelect().disabled).toBe(true);
  });

  it('keeps a broker change pending on a live session until MQTT disconnects', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel('connected');
    await user.selectOptions(liveProfileSelect(), 'profile:chi');
    expect(window.electronAPI.mqtt.updateTopicPrefix).not.toHaveBeenCalled();
    expect(window.electronAPI.mqtt.connect).not.toHaveBeenCalled();
    expect(screen.getByText(/reconnect MQTT to use this profile/i)).toBeInTheDocument();
    expect((liveProfileSelect() as HTMLSelectElement).value).toBe('');
    expect(
      (JSON.parse(localStorage.getItem('mesh-client:mqttSettings') ?? '{}') as { server?: string })
        .server,
    ).toBe('mqtt.meshtastic.org');

    rerender(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
      />,
    );
    expect((document.getElementById('mqtt-server') as HTMLInputElement).value).toBe(
      'mqtt.chimesh.org',
    );
    expect(presetSelect().value).toBe('profile:chi');
    expect(window.electronAPI.mqtt.connect).not.toHaveBeenCalled();
  });

  it('saves, renames and deletes profiles with inline names', async () => {
    const user = userEvent.setup();
    localStorage.setItem('mesh-client:mqttProfiles:meshtastic', '[]');
    renderPanel('disconnected');

    await user.click(screen.getByRole('button', { name: 'Save current as profile' }));
    await user.type(screen.getByRole('textbox', { name: 'Profile name' }), 'USA{Enter}');
    expect(presetSelect().selectedOptions[0]?.textContent).toBe('Saved: USA');

    await user.click(screen.getByRole('button', { name: 'Rename MQTT profile USA' }));
    const nameInput = screen.getByRole('textbox', { name: 'Profile name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'National{Enter}');
    const stored = JSON.parse(
      localStorage.getItem('mesh-client:mqttProfiles:meshtastic') ?? '[]',
    ) as { name: string; server: string }[];
    expect(stored).toEqual([
      expect.objectContaining({ name: 'National', server: 'mqtt.meshtastic.org' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Delete MQTT profile National' }));
    expect(screen.queryByRole('option', { name: 'Saved: National' })).toBeNull();
    expect(localStorage.getItem('mesh-client:mqttProfiles:meshtastic')).toBe('[]');
  });
});
