import { describe, expect, it } from 'vitest';

import {
  nomadPageOverallTimeoutSecs,
  nomadPageProxyTimeoutMs,
  nomadPageProxyTimeoutMsFromApiPath,
  parseReticulumNomadEgressVia,
} from './reticulumNomadTimeouts';

describe('reticulumNomadTimeouts', () => {
  it('uses meshchat-aligned 45s for TCP and network', () => {
    expect(nomadPageOverallTimeoutSecs('tcp', 8)).toBe(45);
    expect(nomadPageOverallTimeoutSecs('network', 1)).toBe(45);
  });

  it('scales RF timeout with hops and caps at 180s', () => {
    expect(nomadPageOverallTimeoutSecs('rf', 1)).toBe(57);
    expect(nomadPageOverallTimeoutSecs('rf', 8)).toBe(99);
    expect(nomadPageOverallTimeoutSecs('rf', 32)).toBe(180);
  });

  it('adds proxy buffer in milliseconds', () => {
    expect(nomadPageProxyTimeoutMs('tcp', 8)).toBe(47_000);
    expect(nomadPageProxyTimeoutMs('rf', 8)).toBe(101_000);
  });

  it('parses egress and hops from nomad page api path', () => {
    expect(
      nomadPageProxyTimeoutMsFromApiPath(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=rf',
      ),
    ).toBe(101_000);
    expect(
      nomadPageProxyTimeoutMsFromApiPath(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&egress=tcp',
      ),
    ).toBe(47_000);
  });

  it('falls back for unknown egress', () => {
    expect(parseReticulumNomadEgressVia('mqtt')).toBe('network');
  });
});
