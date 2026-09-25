import type { TFunction } from 'i18next';

import type { ConnectionStatus, ConnectionType, MeshProtocol } from './types';

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
