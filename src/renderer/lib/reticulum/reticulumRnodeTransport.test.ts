import { describe, expect, it } from 'vitest';

import {
  buildReticulumRnodeTcpPort,
  inferReticulumRnodeTransport,
  isReticulumTcpRnodeSerialPort,
  parseReticulumRnodeTcpPort,
  RNODE_DEFAULT_TCP_PORT,
} from './reticulumRnodeTransport';

describe('reticulumRnodeTransport', () => {
  it('detects tcp:// RNode ports', () => {
    expect(isReticulumTcpRnodeSerialPort('tcp://192.168.1.10')).toBe(true);
    expect(isReticulumTcpRnodeSerialPort('TCP://rnode.local:9000')).toBe(true);
    expect(isReticulumTcpRnodeSerialPort('/dev/ttyUSB0')).toBe(false);
    expect(isReticulumTcpRnodeSerialPort('ble://aa:bb')).toBe(false);
  });

  it('parses tcp:// host and port', () => {
    expect(parseReticulumRnodeTcpPort('tcp://192.168.1.10')).toEqual({
      host: '192.168.1.10',
      port: RNODE_DEFAULT_TCP_PORT,
    });
    expect(parseReticulumRnodeTcpPort('tcp://192.168.1.10:9000')).toEqual({
      host: '192.168.1.10',
      port: 9000,
    });
    expect(parseReticulumRnodeTcpPort('tcp://rnode.local')).toEqual({
      host: 'rnode.local',
      port: RNODE_DEFAULT_TCP_PORT,
    });
    expect(parseReticulumRnodeTcpPort('tcp://[2001:db8::1]:7633')).toEqual({
      host: '2001:db8::1',
      port: 7633,
    });
    expect(parseReticulumRnodeTcpPort('tcp://2001:db8::1:9000')).toEqual({
      host: '2001:db8::1',
      port: 9000,
    });
    expect(parseReticulumRnodeTcpPort('tcp://2001:db8::1')).toEqual({
      host: '2001:db8::1',
      port: RNODE_DEFAULT_TCP_PORT,
    });
  });

  it('builds tcp:// URIs with default port omitted', () => {
    expect(buildReticulumRnodeTcpPort('192.168.1.42')).toBe('tcp://192.168.1.42');
    expect(buildReticulumRnodeTcpPort('192.168.1.42', 7633)).toBe('tcp://192.168.1.42');
    expect(buildReticulumRnodeTcpPort('192.168.1.42', 9000)).toBe('tcp://192.168.1.42:9000');
    expect(buildReticulumRnodeTcpPort('2001:db8::1')).toBe('tcp://[2001:db8::1]');
    expect(buildReticulumRnodeTcpPort('2001:db8::1', 9000)).toBe('tcp://[2001:db8::1]:9000');
    expect(buildReticulumRnodeTcpPort('  ')).toBe('');
  });

  it('infers transport kind from serial_port', () => {
    expect(inferReticulumRnodeTransport('tcp://10.0.0.1')).toBe('wifi');
    expect(inferReticulumRnodeTransport('ble://AA:BB:CC:DD:EE:FF')).toBe('ble');
    expect(inferReticulumRnodeTransport('/dev/ttyUSB0')).toBe('serial');
  });
});
