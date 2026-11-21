import { describe, expect, it } from 'vitest';

import { meshcomTransportSupportsDmDeliveryAck } from './meshcomDmDeliveryAck';

describe('meshcomTransportSupportsDmDeliveryAck', () => {
  it('allows BLE and KISS (tcp) only', () => {
    expect(meshcomTransportSupportsDmDeliveryAck('ble')).toBe(true);
    expect(meshcomTransportSupportsDmDeliveryAck('tcp')).toBe(true);
    expect(meshcomTransportSupportsDmDeliveryAck('serial')).toBe(false);
    expect(meshcomTransportSupportsDmDeliveryAck('udp')).toBe(false);
  });
});
