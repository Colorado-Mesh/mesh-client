import type { LookupFunction } from 'node:net';

import { Agent } from 'undici';

import { stripConnectHostBrackets } from '../shared/connectHost';
import { ipLiteralFamily, isGlobalIpLiteral, isValidIpLiteral } from '../shared/ipLiteral';

/** True when `address` is an IP literal that is globally reachable. */
export function isGlobalPublicAddress(address: string): boolean {
  return isGlobalIpLiteral(address) === true;
}

/** Socket lookup that always returns the address already checked (no second DNS query). */
export function pinnedPublicLookup(address: string): LookupFunction {
  const family = ipLiteralFamily(address) === 4 ? 4 : 6;
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

/** Explicit URL port, or the scheme default. */
export function pinnedConnectPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'http:' ? 80 : 443;
}

/**
 * Undici agent whose connect lookup is pinned to `address`.
 * `address` must already have passed {@link isGlobalPublicAddress}.
 */
export function createPinnedPublicAgent(url: URL, address: string): Agent {
  const hostname = stripConnectHostBrackets(url.hostname);
  const servername = isValidIpLiteral(hostname) ? undefined : hostname;
  return new Agent({
    connect: {
      lookup: pinnedPublicLookup(address),
      port: pinnedConnectPort(url),
      servername,
    },
  });
}
