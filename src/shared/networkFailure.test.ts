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
  ])('classifies %s as network-class', (msg) => {
    expect(isNetworkClassFailure(new Error(msg))).toBe(true);
  });

  it.each(['HTTP 503', 'disk full', 'signature verification failed', 'Cannot download status:404'])(
    'does not classify %s as network-class',
    (msg) => {
      expect(isNetworkClassFailure(new Error(msg))).toBe(false);
    },
  );
});
