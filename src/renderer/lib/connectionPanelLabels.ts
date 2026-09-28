import type { TFunction } from 'i18next';

import type { ConnectionStatus, ConnectionType, MeshProtocol, MQTTStatus } from './types';

/** Localized radio status for ConnectionPanel (reuses header `app.deviceStatus` keys). */
export function connectionPanelRadioStatusLabel(t: TFunction, status: ConnectionStatus): string {
  switch (status) {
    case 'disconnected':
      return t('app.deviceStatus.disconnected');
    case 'connecting':
      return t('app.deviceStatus.connecting');
    case 'connected':
      return t('app.deviceStatus.connected');
    case 'configured':
      return t('app.deviceStatus.configured');
    case 'stale':
      return t('app.deviceStatus.stale');
    case 'reconnecting':
      return t('app.deviceStatus.reconnecting');
    default: {
      const _x: never = status;
      return _x;
    }
  }
}

/** Localized transport label matching the Connection type selector. */
export function connectionPanelConnectionTypeLabel(
  t: TFunction,
  type: ConnectionType,
  protocol: MeshProtocol,
): string {
  switch (type) {
    case 'ble':
      return t('connectionPanel.bluetooth');
    case 'serial':
      return t('connectionPanel.usbSerial');
    case 'tcp':
      return t('connectionPanel.wifiTcp');
    case 'http':
      return protocol === 'meshcore' ? t('connectionPanel.tcpIp') : t('connectionPanel.wifiHttp');
    default: {
      const _x: never = type;
      return _x;
    }
  }
}

/** MQTT link status for the Connection tiles (sentence case, reuses `app.deviceStatus`). */
export function connectionPanelMqttStatusLabel(
  t: TFunction,
  status: MQTTStatus,
  connectionLoss = false,
): string {
  if (status === 'error' || connectionLoss) return t('connectionPanel.tiles.error');
  if (status === 'connected') return t('app.deviceStatus.connected');
  if (status === 'connecting') return t('app.deviceStatus.connecting');
  return t('app.deviceStatus.disconnected');
}

/** TAK server status for the Connection tiles. */
export function connectionPanelTakStatusLabel(
  t: TFunction,
  running: boolean,
  serverError: boolean,
  clientLoss: boolean,
): string {
  if (running && clientLoss) return t('connectionPanel.tiles.clientLost');
  if (running) return t('connectionPanel.tiles.running');
  if (serverError) return t('connectionPanel.tiles.error');
  return t('connectionPanel.tiles.stopped');
}
