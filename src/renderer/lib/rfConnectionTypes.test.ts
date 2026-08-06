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
    expect(rfConnectionTransportOpts('tcp', { httpAddress: 'host:4403' })).toEqual({
      type: 'tcp',
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

  it('maps discriminated tcp opts to meshtastic transport params', () => {
    expect(
      protocolTransportParams('meshtastic', {
        type: 'tcp',
        httpAddress: '192.168.200.4:4403',
      }),
    ).toEqual({ type: 'tcp', host: '192.168.200.4:4403' });
  });

  it('maps MeshCore http UI type to tcp transport params with host', () => {
    expect(
      protocolTransportParams('meshcore', {
        type: 'http',
        httpAddress: '192.168.88.29:5050',
      }),
    ).toEqual({ type: 'tcp', host: '192.168.88.29:5050' });
  });

  it('maps MeshCore tcp UI type to tcp transport params with host', () => {
    expect(
      protocolTransportParams('meshcore', {
        type: 'tcp',
        httpAddress: '10.0.0.2:5050',
      }),
    ).toEqual({ type: 'tcp', host: '10.0.0.2:5050' });
  });
});
