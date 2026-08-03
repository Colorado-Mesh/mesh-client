// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isExpectedReticulumProxyError,
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
    'The operation was aborted',
    'The operation was aborted due to timeout',
    'request timeout',
    'sidecar timeout',
    'link timed out waiting for proof',
    'reticulum:proxy: rate limit exceeded',
    'sidecar GET /api/v1/topology failed: 404',
  ])('treats %j as expected', (message) => {
    expect(isExpectedReticulumProxyErrorMessage(message)).toBe(true);
    expect(isExpectedReticulumProxyError(new Error(message))).toBe(true);
  });

  it('rejects unrelated errors and unanchored 404/timeout substrings', () => {
    expect(isExpectedReticulumProxyErrorMessage('EACCES permission denied')).toBe(false);
    expect(isExpectedReticulumProxyErrorMessage('channel 1404 unavailable')).toBe(false);
    expect(isExpectedReticulumProxyErrorMessage('payload size 4048 bytes')).toBe(false);
    expect(isExpectedReticulumProxyErrorMessage('HTTP 404')).toBe(false);
    expect(isExpectedReticulumProxyError(new Error('EACCES permission denied'))).toBe(false);
  });

  it('treats structured status/statusCode 404 and Abort/Timeout names as expected', () => {
    expect(isExpectedReticulumProxyError({ status: 404, message: 'missing' })).toBe(true);
    expect(isExpectedReticulumProxyError({ statusCode: '404' })).toBe(true);
    expect(isExpectedReticulumProxyError({ name: 'AbortError', message: 'aborted' })).toBe(true);
    expect(isExpectedReticulumProxyError({ name: 'TimeoutError', message: 'took too long' })).toBe(
      true,
    );
    expect(isExpectedReticulumProxyError({ status: 500, message: 'boom' })).toBe(false);
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
