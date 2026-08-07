// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isLiveTcpSession,
  parseHttpProbeTarget,
  parseTcpProbeTarget,
  rttToSignalLevel,
} from './hostLinkQuality';
import type { ConnectionType, MeshProtocol } from './types';

describe('rttToSignalLevel', () => {
  it('maps latency buckets to 0–4 bars', () => {
    expect(rttToSignalLevel(null)).toBe(0);
    expect(rttToSignalLevel(undefined)).toBe(0);
    expect(rttToSignalLevel(Number.NaN)).toBe(0);
    expect(rttToSignalLevel(-1)).toBe(0);
    expect(rttToSignalLevel(0)).toBe(4);
    expect(rttToSignalLevel(50)).toBe(4);
    expect(rttToSignalLevel(51)).toBe(3);
    expect(rttToSignalLevel(100)).toBe(3);
    expect(rttToSignalLevel(101)).toBe(2);
    expect(rttToSignalLevel(250)).toBe(2);
    expect(rttToSignalLevel(251)).toBe(1);
    expect(rttToSignalLevel(500)).toBe(1);
    expect(rttToSignalLevel(501)).toBe(0);
  });
});

describe('parseHttpProbeTarget', () => {
  it('parses bare host and https', () => {
    expect(parseHttpProbeTarget('meshtastic.local')).toEqual({
      urlHost: 'meshtastic.local:80',
      tls: false,
    });
    expect(parseHttpProbeTarget('https://radio.local/')).toEqual({
      urlHost: 'radio.local:443',
      tls: true,
    });
  });

  it('returns null for empty input', () => {
    expect(parseHttpProbeTarget('')).toBeNull();
    expect(parseHttpProbeTarget('   ')).toBeNull();
  });
});

describe('parseTcpProbeTarget', () => {
  it('defaults Meshtastic to 4403 and MeshCore to 5000', () => {
    expect(parseTcpProbeTarget('10.0.0.5', 'meshtastic')).toEqual({
      host: '10.0.0.5',
      port: 4403,
    });
    expect(parseTcpProbeTarget('10.0.0.5', 'meshcore')).toEqual({
      host: '10.0.0.5',
      port: 5000,
    });
  });
});

describe('isLiveTcpSession', () => {
  it.each([
    ['meshtastic', 'tcp', true],
    ['meshcore', 'http', true],
    ['meshtastic', 'http', false],
    ['meshcore', 'tcp', false],
    ['meshcore', 'ble', false],
    ['reticulum', 'ble', false],
    ['reticulum', 'http', false],
    ['meshtastic', null, false],
  ] as const satisfies readonly (readonly [MeshProtocol, ConnectionType | null, boolean])[])(
    '%s + %s → %s',
    (protocol, connectionType, expected) => {
      expect(isLiveTcpSession(protocol, connectionType)).toBe(expected);
    },
  );
});
