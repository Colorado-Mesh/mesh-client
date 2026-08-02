import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NobleBleLinkRssiPayload } from '@/shared/electron-api.types';

import ConnectionPanel from './ConnectionPanel';

describe('ConnectionPanel host link meter', () => {
  afterEach(() => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.clearAllMocks();
  });

  it('shows Signal meter for configured BLE on darwin', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    let rssiCb: ((p: NobleBleLinkRssiPayload) => void) | null = null;
    vi.mocked(window.electronAPI.onNobleBleLinkRssi).mockImplementation((cb) => {
      rssiCb = cb;
      return () => {};
    });

    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'ble',
          firmwareVersion: '2.5.3',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        suppressMountAutoConnect
      />,
    );
    expect(screen.getByText('Signal')).toBeInTheDocument();
    act(() => {
      rssiCb?.({ sessionId: 'meshtastic', rssi: -66 });
    });
    await waitFor(() => {
      expect(screen.getByText('-66 dBm')).toBeInTheDocument();
    });
  });

  it('shows Unavailable (Web Bluetooth) for configured BLE on linux', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'ble',
          firmwareVersion: '2.5.3',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        suppressMountAutoConnect
      />,
    );
    expect(screen.getByText('Unavailable (Web Bluetooth)')).toBeInTheDocument();
  });

  it('shows Link quality for configured HTTP on linux', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockResolvedValue(45);
    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'http',
          firmwareVersion: '2.5.3',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        suppressMountAutoConnect
      />,
    );
    expect(screen.getByText('Link quality')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('45 ms')).toBeInTheDocument();
    });
  });

  it('hides host link meter for serial connections', () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'serial',
          firmwareVersion: '2.5.3',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        suppressMountAutoConnect
      />,
    );
    expect(screen.queryByText('Signal')).not.toBeInTheDocument();
    expect(screen.queryByText('Link quality')).not.toBeInTheDocument();
  });

  it('shows Link quality for MeshCore TCP/IP on linux', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(88);
    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'http',
          firmwareVersion: '1.0.0',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshcore"
        suppressMountAutoConnect
      />,
    );
    expect(screen.getByText('Link quality')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalled();
    });
  });

  it('shows Link quality for Meshtastic TCP', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('darwin');
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(120);
    render(
      <ConnectionPanel
        state={{
          status: 'configured',
          myNodeNum: 1,
          connectionType: 'tcp',
          firmwareVersion: '2.5.3',
        }}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
        protocol="meshtastic"
        suppressMountAutoConnect
      />,
    );
    expect(screen.getByText('Link quality')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalled();
    });
  });
});
