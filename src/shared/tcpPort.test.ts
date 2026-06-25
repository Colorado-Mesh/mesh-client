import { describe, expect, it } from 'vitest';

import { clampTcpPort, parseTcpPortFromString } from './tcpPort';

describe('clampTcpPort', () => {
  it('returns parsed integer within range', () => {
    expect(clampTcpPort('1883', 5000)).toBe(1883);
    expect(clampTcpPort(443, 5000)).toBe(443);
  });

  it('clamps below minimum to 1', () => {
    expect(clampTcpPort('0', 5000)).toBe(1);
    expect(clampTcpPort('-10', 5000)).toBe(1);
  });

  it('clamps above maximum to 65535', () => {
    expect(clampTcpPort('70000', 5000)).toBe(65535);
    expect(clampTcpPort(100_000, 5000)).toBe(65535);
  });

  it('returns fallback for non-numeric input', () => {
    expect(clampTcpPort('', 1883)).toBe(1883);
    expect(clampTcpPort('abc', 5000)).toBe(5000);
  });
});

describe('parseTcpPortFromString', () => {
  it('returns fallback for out-of-range or non-numeric input', () => {
    expect(parseTcpPortFromString('0', 5000)).toBe(5000);
    expect(parseTcpPortFromString('65536', 5000)).toBe(5000);
    expect(parseTcpPortFromString('abc', 5000)).toBe(5000);
    expect(parseTcpPortFromString('5001', 5000)).toBe(5001);
  });
});
