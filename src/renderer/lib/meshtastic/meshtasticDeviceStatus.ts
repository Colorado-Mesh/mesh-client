import { Types } from '@meshtastic/core';

const { DeviceStatusEnum } = Types;

export type MeshtasticDeviceStatus =
  'connecting' | 'disconnected' | 'connected' | 'configured' | 'stale';

const STATUS_CODE_MAP: Record<number, MeshtasticDeviceStatus> = {
  [DeviceStatusEnum.DeviceRestarting]: 'connecting',
  [DeviceStatusEnum.DeviceDisconnected]: 'disconnected',
  [DeviceStatusEnum.DeviceConnecting]: 'connecting',
  [DeviceStatusEnum.DeviceReconnecting]: 'connecting',
  [DeviceStatusEnum.DeviceConnected]: 'connected',
  [DeviceStatusEnum.DeviceConfiguring]: 'connecting',
  [DeviceStatusEnum.DeviceConfigured]: 'configured',
  8: 'stale',
};

export function meshtasticDeviceStatusForCode(status: number): MeshtasticDeviceStatus {
  return STATUS_CODE_MAP[status] ?? 'connected';
}
