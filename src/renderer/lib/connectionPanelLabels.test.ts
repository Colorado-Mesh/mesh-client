import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  connectionPanelConnectionTypeLabel,
  connectionPanelMqttStatusLabel,
  connectionPanelRadioStatusLabel,
  connectionPanelTakStatusLabel,
} from './connectionPanelLabels';
import type { ConnectionStatus, ConnectionType, MeshProtocol, MQTTStatus } from './types';

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

describe('connectionPanelMqttStatusLabel', () => {
  it.each<[MQTTStatus, boolean, string]>([
    ['connected', false, 'app.deviceStatus.connected'],
    ['connecting', false, 'app.deviceStatus.connecting'],
    ['disconnected', false, 'app.deviceStatus.disconnected'],
    ['error', false, 'connectionPanel.tiles.error'],
    ['connecting', true, 'connectionPanel.tiles.error'],
  ])('maps %s (loss %s) to %s', (status, loss, key) => {
    expect(connectionPanelMqttStatusLabel(mockT(), status, loss)).toBe(key);
  });
});

describe('connectionPanelTakStatusLabel', () => {
  it.each<[boolean, boolean, boolean, string]>([
    [true, false, false, 'connectionPanel.tiles.running'],
    [true, false, true, 'connectionPanel.tiles.clientLost'],
    [false, true, false, 'connectionPanel.tiles.error'],
    [false, false, false, 'connectionPanel.tiles.stopped'],
  ])('running %s, error %s, client loss %s maps to %s', (running, error, loss, key) => {
    expect(connectionPanelTakStatusLabel(mockT(), running, error, loss)).toBe(key);
  });
});
