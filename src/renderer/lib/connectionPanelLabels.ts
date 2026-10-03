import type { TFunction } from 'i18next';

import type { TAKRemoteStatus } from '@/shared/tak-types';

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

export type TakRemoteLabelState = 'connected' | 'connecting' | 'error';

/** Remote relay state worth showing, or null while it is off without an error. */
export function takRemoteLabelState(
  remote: Pick<TAKRemoteStatus, 'state' | 'error'>,
): TakRemoteLabelState | null {
  if (remote.state === 'connected') return 'connected';
  if (remote.error) return 'error';
  if (remote.state === 'connecting') return 'connecting';
  return null;
}

/** Remote relay status for the Connection TAK tile, or null while the relay is off. */
export function connectionPanelTakRemoteLabel(
  t: TFunction,
  remote: Pick<TAKRemoteStatus, 'state' | 'error'>,
): string | null {
  switch (takRemoteLabelState(remote)) {
    case 'connected':
      return t('connectionPanel.tiles.remoteConnected');
    case 'connecting':
      return t('connectionPanel.tiles.remoteConnecting');
    case 'error':
      return t('connectionPanel.tiles.remoteError');
    default:
      return null;
  }
}

/** Status bar text and accessible name for the single TAK icon (local server + remote relay). */
export function takStatusBarLabels(
  t: TFunction,
  running: boolean,
  clientLoss: boolean,
  remote: Pick<TAKRemoteStatus, 'state' | 'error'>,
): { label: string; ariaLabel: string } {
  const lost = running && clientLoss;
  const localLabel = lost ? t('app.takClientLost') : running ? t('app.takRunning') : null;
  const localAria = lost
    ? t('app.takClientLost')
    : running
      ? t('app.takServerRunning')
      : t('app.takServerStopped');
  const remoteState = takRemoteLabelState(remote);
  const remoteLabel =
    remoteState === 'connected'
      ? t('app.takRemoteConnected')
      : remoteState === 'connecting'
        ? t('app.takRemoteConnecting')
        : remoteState === 'error'
          ? t('app.takRemoteError')
          : null;
  if (!remoteLabel) {
    return { label: localLabel ?? t('app.takStopped'), ariaLabel: localAria };
  }
  if (!running) {
    const only = t('app.takRemoteOnly', { remote: remoteLabel });
    return { label: only, ariaLabel: only };
  }
  return {
    label: t('app.takWithRemote', { local: localLabel, remote: remoteLabel }),
    ariaLabel: t('app.takWithRemote', { local: localAria, remote: remoteLabel }),
  };
}
