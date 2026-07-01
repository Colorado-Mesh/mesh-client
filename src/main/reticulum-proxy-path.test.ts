import { describe, expect, it } from 'vitest';

import { assertReticulumProxyPath, reticulumProxyGetTimeoutMs } from './reticulum-proxy-path';

describe('assertReticulumProxyPath', () => {
  it('normalizes paths without a leading slash', () => {
    expect(assertReticulumProxyPath('api/v1/status')).toBe('/api/v1/status');
  });

  it('accepts valid API paths', () => {
    expect(assertReticulumProxyPath('/api/v1/peers')).toBe('/api/v1/peers');
    expect(assertReticulumProxyPath('/api/v1/interfaces/abc/enable')).toBe(
      '/api/v1/interfaces/abc/enable',
    );
  });

  it('preserves query strings on nomad page paths', () => {
    expect(
      assertReticulumProxyPath(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=rf',
      ),
    ).toBe('/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=rf');
  });

  it('rejects paths outside /api/v1/', () => {
    expect(() => assertReticulumProxyPath('/ws')).toThrow(/must start with/);
    expect(() => assertReticulumProxyPath('/api/v2/status')).toThrow(/must start with/);
  });

  it('rejects traversal segments', () => {
    expect(() => assertReticulumProxyPath('/api/v1/../system/factory-reset')).toThrow(
      /invalid segments/,
    );
  });
});

describe('reticulumProxyGetTimeoutMs', () => {
  it('uses meshchat-aligned timeout for TCP nomad page fetches', () => {
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=tcp',
      ),
    ).toBe(47_000);
  });

  it('uses longer RF timeout from hops and egress', () => {
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=rf',
      ),
    ).toBe(101_000);
  });

  it('uses nomad timeout for file fetches', () => {
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/file/abc?path=%2Ffile%2Freadme.txt&hops=8&egress=rf',
      ),
    ).toBe(101_000);
  });

  it('uses default timeout for other GET routes', () => {
    expect(reticulumProxyGetTimeoutMs('/api/v1/nomadnetwork/nodes')).toBe(10_000);
  });
});
