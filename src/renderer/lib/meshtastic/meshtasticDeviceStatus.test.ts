import { Types } from '@meshtastic/core';
import { describe, expect, it } from 'vitest';

import { meshtasticDeviceStatusForCode } from './meshtasticDeviceStatus';

const { DeviceStatusEnum } = Types;

describe('meshtasticDeviceStatusForCode', () => {
  it.each([
    [DeviceStatusEnum.DeviceDisconnected, 'disconnected'],
    [DeviceStatusEnum.DeviceConnecting, 'connecting'],
    [DeviceStatusEnum.DeviceConnected, 'connected'],
    [DeviceStatusEnum.DeviceConfigured, 'configured'],
    [8, 'stale'],
  ] as const)('maps %s → %s', (code, status) => {
    expect(meshtasticDeviceStatusForCode(code)).toBe(status);
  });

  it('defaults unknown codes to connected', () => {
    expect(meshtasticDeviceStatusForCode(999)).toBe('connected');
  });
});
