import { describe, expect, it } from 'vitest';

import { MESHCOM_EXTUDP_PORT, MESHCOM_KISS_TCP_PORT } from '@/shared/meshcomConstants';

import { meshcomConnectionType, protocolTransportParams } from './protocolTransportParams';

describe('meshcomConnectionType', () => {
  it('maps http UI to tcp (KISS)', () => {
    expect(meshcomConnectionType('http')).toBe('tcp');
  });

  it('keeps udp', () => {
    expect(meshcomConnectionType('udp')).toBe('udp');
  });
});

describe('protocolTransportParams meshcom', () => {
  it('defaults EXTUDP port when host has no port', () => {
    const params = protocolTransportParams('meshcom', {
      type: 'udp',
      httpAddress: '192.168.1.10',
    });
    expect(params).toEqual({ type: 'udp', host: `192.168.1.10:${MESHCOM_EXTUDP_PORT}` });
  });

  it('defaults KISS TCP port for http UI type', () => {
    const params = protocolTransportParams('meshcom', {
      type: 'http',
      httpAddress: '10.0.0.2',
    });
    expect(params).toEqual({ type: 'tcp', host: `10.0.0.2:${MESHCOM_KISS_TCP_PORT}` });
  });
});
