// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isNetworkClassFailure } from './networkFailure';

describe('isNetworkClassFailure', () => {
  it.each([
    'getaddrinfo ENOTFOUND api.github.com',
    'connect ECONNREFUSED 127.0.0.1:443',
    'read ECONNRESET',
    'request to https://x timed out',
    'The operation was aborted',
    'net::ERR_INTERNET_DISCONNECTED',
    'offline now',
    'Network Error',
    'fetch timeout while connecting',
  ])('classifies %s as network-class', (msg) => {
    expect(isNetworkClassFailure(new Error(msg))).toBe(true);
  });

  it.each([
    'HTTP 503',
    'disk full',
    'signature verification failed',
    'Cannot download status:404',
    'please abort the mission later',
    'disk lock timeout',
    'database query timeout exceeded',
  ])('does not classify %s as network-class', (msg) => {
    expect(isNetworkClassFailure(new Error(msg))).toBe(false);
  });

  it('classifies nested fetch cause codes as offline', () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    });
    expect(isNetworkClassFailure(err)).toBe(true);
  });

  it('classifies AbortError by name alone', () => {
    const err = new Error('opaque');
    err.name = 'AbortError';
    expect(isNetworkClassFailure(err)).toBe(true);
  });

  it('classifies TimeoutError by name alone', () => {
    const err = new Error('opaque');
    err.name = 'TimeoutError';
    expect(isNetworkClassFailure(err)).toBe(true);
  });
});
