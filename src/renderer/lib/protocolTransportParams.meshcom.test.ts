import { describe, expect, it } from 'vitest';

import {
  MESHCOM_EXTUDP_PORT,
  MESHCOM_KISS_TCP_PORT,
  MESHCOM_NETCONSOLE_PORT,
} from '@/shared/meshcomConstants';

import { meshcomConnectionType, protocolTransportParams } from './protocolTransportParams';

describe('meshcomConnectionType', () => {
  it('maps http UI to tcp (KISS)', () => {
    expect(meshcomConnectionType('http')).toBe('tcp');
  });

  it('keeps udp and netconsole', () => {
    expect(meshcomConnectionType('udp')).toBe('udp');
    expect(meshcomConnectionType('netconsole')).toBe('netconsole');
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

  it('defaults NET Console port', () => {
    const params = protocolTransportParams('meshcom', {
      type: 'netconsole',
      httpAddress: '10.0.0.3',
    });
    expect(params).toEqual({
      type: 'netconsole',
      host: `10.0.0.3:${MESHCOM_NETCONSOLE_PORT}`,
    });
  });
});
