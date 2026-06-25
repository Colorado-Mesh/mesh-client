import { describe, expect, it } from 'vitest';

import { protocolTransportParams } from './protocolTransportParams';
import { rfConnectionTransportOpts } from './rfConnectionTypes';

describe('rfConnectionTransportOpts', () => {
  it('keeps only transport-relevant fields per type', () => {
    expect(rfConnectionTransportOpts('ble', { blePeripheralId: 'abc', httpAddress: 'x' })).toEqual({
      type: 'ble',
      blePeripheralId: 'abc',
    });
    expect(
      rfConnectionTransportOpts('serial', { lastSerialPortId: 'COM3', blePeripheralId: 'x' }),
    ).toEqual({
      type: 'serial',
      lastSerialPortId: 'COM3',
    });
    expect(rfConnectionTransportOpts('http', { httpAddress: 'host:4403' })).toEqual({
      type: 'http',
      httpAddress: 'host:4403',
    });
  });
});

describe('protocolTransportParams', () => {
  it('maps discriminated opts to meshtastic transport params', () => {
    expect(
      protocolTransportParams('meshtastic', {
        type: 'http',
        httpAddress: '127.0.0.1:4403',
      }),
    ).toEqual({ type: 'http', host: '127.0.0.1:4403' });
  });
});
