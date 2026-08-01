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
    expect(() => assertReticulumProxyPath('/api/v1/%2e%2e/system/factory-reset')).toThrow(
      /invalid segments/,
    );
  });

  it('rejects paths with fragments in the path segment', () => {
    expect(assertReticulumProxyPath('/api/v1/peers#frag')).toBe('/api/v1/peers#frag');
  });

  it('rejects factory-reset on the generic proxy path', () => {
    expect(() => assertReticulumProxyPath('/api/v1/system/factory-reset')).toThrow(/factoryReset/);
  });

  it('allows factory-reset when explicitly opted in', () => {
    expect(
      assertReticulumProxyPath('/api/v1/system/factory-reset', { allowFactoryReset: true }),
    ).toBe('/api/v1/system/factory-reset');
  });
});

describe('reticulumProxyGetTimeoutMs', () => {
  it('uses flat Nomad proxy cap for page fetches (ignores stale hops/egress)', () => {
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=1&egress=tcp',
      ),
    ).toBe(185_000);
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/page/abc?path=%2Fpage%2Findex.mu&hops=8&egress=rf',
      ),
    ).toBe(185_000);
  });

  it('uses flat Nomad proxy cap for file fetches', () => {
    expect(
      reticulumProxyGetTimeoutMs(
        '/api/v1/nomadnetwork/file/abc?path=%2Ffile%2Freadme.txt&hops=8&egress=rf',
      ),
    ).toBe(185_000);
  });

  it('uses default timeout for other GET routes', () => {
    expect(reticulumProxyGetTimeoutMs('/api/v1/nomadnetwork/nodes')).toBe(10_000);
  });

  it('uses longer timeout for transport query routes', () => {
    expect(reticulumProxyGetTimeoutMs('/api/v1/peers')).toBe(30_000);
    expect(reticulumProxyGetTimeoutMs('/api/v1/interfaces')).toBe(30_000);
    expect(reticulumProxyGetTimeoutMs('/api/v1/topology')).toBe(30_000);
    expect(reticulumProxyGetTimeoutMs('/api/v1/packets?limit=500')).toBe(30_000);
    expect(reticulumProxyGetTimeoutMs('/api/v1/lxmf/recent?limit=200')).toBe(30_000);
  });
});
