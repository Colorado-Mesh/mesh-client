import { describe, expect, it } from 'vitest';

import { assertReticulumProxyPath } from './reticulum-proxy-path';

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
