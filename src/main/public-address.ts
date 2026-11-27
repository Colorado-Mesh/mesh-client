import dns from 'node:dns/promises';
import type { LookupFunction } from 'node:net';

import { isGlobalIpLiteral } from '../shared/ipLiteral';
import { MS_PER_SECOND } from '../shared/timeConstants';

const DEFAULT_DNS_TIMEOUT_MS = 3 * MS_PER_SECOND;

/** A DNS answer that was checked to be a global (public internet) address. */
export interface PublicAddress {
  address: string;
  family: 4 | 6;
}

/** Caller wording, so each client keeps its own user-facing messages. */
export interface PublicAddressMessages {
  timeout: string;
  notPublic: string;
}

/** Resolves `hostname` once and refuses private, loopback, link-local and other non-global answers. */
export async function resolvePublicAddress(
  hostname: string,
  messages: PublicAddressMessages,
  timeoutMs: number = DEFAULT_DNS_TIMEOUT_MS,
): Promise<PublicAddress> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      dns.lookup(hostname, { order: 'verbatim' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(messages.timeout));
        }, timeoutMs);
      }),
    ]);
    const global = isGlobalIpLiteral(result.address) === true;
    if (!global || (result.family !== 4 && result.family !== 6)) {
      throw new Error(messages.notPublic);
    }
    return { address: result.address, family: result.family };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Connects to the already-validated address, so a second DNS answer cannot rebind the request. */
export function pinnedLookup(address: PublicAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };
}
