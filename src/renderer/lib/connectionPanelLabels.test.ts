import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  connectionPanelConnectionTypeLabel,
  connectionPanelRadioStatusLabel,
} from './connectionPanelLabels';
import type { ConnectionStatus, ConnectionType, MeshProtocol } from './types';

function mockT(): TFunction {
  return ((key: string) => key) as TFunction;
}

describe('connectionPanelRadioStatusLabel', () => {
  it.each<[ConnectionStatus, string]>([
    ['disconnected', 'app.deviceStatus.disconnected'],
    ['connecting', 'app.deviceStatus.connecting'],
    ['connected', 'app.deviceStatus.connected'],
    ['configured', 'app.deviceStatus.configured'],
    ['stale', 'app.deviceStatus.stale'],
    ['reconnecting', 'app.deviceStatus.reconnecting'],
  ])('maps %s to %s', (status, key) => {
    expect(connectionPanelRadioStatusLabel(mockT(), status)).toBe(key);
  });
});

describe('connectionPanelConnectionTypeLabel', () => {
  it.each<[ConnectionType, MeshProtocol, string]>([
    ['ble', 'meshtastic', 'connectionPanel.bluetooth'],
    ['serial', 'meshtastic', 'connectionPanel.usbSerial'],
    ['tcp', 'meshtastic', 'connectionPanel.wifiTcp'],
    ['http', 'meshtastic', 'connectionPanel.wifiHttp'],
    ['http', 'meshcore', 'connectionPanel.tcpIp'],
    ['ble', 'meshcore', 'connectionPanel.bluetooth'],
    ['http', 'reticulum', 'connectionPanel.wifiHttp'],
  ])('maps %s/%s to %s', (type, protocol, key) => {
    expect(connectionPanelConnectionTypeLabel(mockT(), type, protocol)).toBe(key);
  });
});
