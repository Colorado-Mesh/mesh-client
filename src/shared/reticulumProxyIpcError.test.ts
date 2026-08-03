// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isExpectedReticulumProxyErrorMessage,
  isReticulumProxyIpcErrorEnvelope,
  reticulumProxyIpcErrorEnvelope,
  throwIfReticulumProxyIpcError,
} from './reticulumProxyIpcError';

describe('reticulumProxyIpcError', () => {
  it.each([
    'Reticulum sidecar is not running',
    'fetch failed',
    'TypeError: fetch failed',
    'aborted',
    'request timeout',
    'rate limit exceeded',
    'HTTP 404',
  ])('treats %j as expected', (message) => {
    expect(isExpectedReticulumProxyErrorMessage(message)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isExpectedReticulumProxyErrorMessage('EACCES permission denied')).toBe(false);
  });

  it('builds and detects envelopes', () => {
    const env = reticulumProxyIpcErrorEnvelope('Reticulum sidecar is not running');
    expect(isReticulumProxyIpcErrorEnvelope(env)).toBe(true);
    expect(isReticulumProxyIpcErrorEnvelope({ ok: true })).toBe(false);
    expect(isReticulumProxyIpcErrorEnvelope(null)).toBe(false);
  });

  it('throwIfReticulumProxyIpcError rethrows envelopes and passes through values', () => {
    expect(throwIfReticulumProxyIpcError({ peers: [] })).toEqual({ peers: [] });
    expect(() =>
      throwIfReticulumProxyIpcError(reticulumProxyIpcErrorEnvelope('fetch failed')),
    ).toThrow('fetch failed');
  });
});
