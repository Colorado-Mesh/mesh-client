// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  MESHTASTIC_TCP_DEFAULT_PORT,
  parseMeshtasticTcpAddress,
} from './parseMeshtasticTcpAddress';

describe('parseMeshtasticTcpAddress', () => {
  it('defaults to port 4403 when omitted', () => {
    expect(parseMeshtasticTcpAddress('192.168.1.10')).toEqual({
      host: '192.168.1.10',
      port: MESHTASTIC_TCP_DEFAULT_PORT,
    });
  });

  it('parses host:port', () => {
    expect(parseMeshtasticTcpAddress('meshtastic.local:4403')).toEqual({
      host: 'meshtastic.local',
      port: 4403,
    });
  });

  it('trims whitespace', () => {
    expect(parseMeshtasticTcpAddress('  10.0.0.5:4403  ')).toEqual({
      host: '10.0.0.5',
      port: 4403,
    });
  });
});
