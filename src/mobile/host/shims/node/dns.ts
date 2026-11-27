/**
 * `dns` and `dns/promises` shim for the mobile host worker. Resolution happens natively
 * (`MeshNet.dnsLookup`) so SSRF / public-address checks in main see real addresses.
 */
import { callNative } from '../../hostChannel';
import { isIP } from './net';

export interface LookupAddress {
  address: string;
  family: number;
}

async function nativeLookup(hostname: string, family?: number): Promise<LookupAddress[]> {
  const fam = isIP(hostname);
  if (fam) return [{ address: hostname, family: fam }];
  if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }];
  const r = await callNative<{ addresses: LookupAddress[] }>('MeshNet', 'dnsLookup', {
    hostname,
    family: family ?? 0,
  });
  const list = r.addresses.filter((a) => !family || a.family === family);
  if (list.length === 0) {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
      hostname,
    });
  }
  return list;
}

export interface LookupOpts {
  family?: number | 'IPv4' | 'IPv6';
  all?: boolean;
  verbatim?: boolean;
}

function famNum(f: LookupOpts['family']): number | undefined {
  if (f === 'IPv4') return 4;
  if (f === 'IPv6') return 6;
  return typeof f === 'number' && f !== 0 ? f : undefined;
}

export const promises = {
  async lookup(
    hostname: string,
    opts?: LookupOpts | number,
  ): Promise<LookupAddress | LookupAddress[]> {
    const o: LookupOpts = typeof opts === 'number' ? { family: opts } : (opts ?? {});
    const list = await nativeLookup(hostname, famNum(o.family));
    return o.all ? list : list[0];
  },
  async resolve4(hostname: string): Promise<string[]> {
    return (await nativeLookup(hostname, 4)).map((a) => a.address);
  },
  async resolve6(hostname: string): Promise<string[]> {
    return (await nativeLookup(hostname, 6)).map((a) => a.address);
  },
  async resolve(hostname: string): Promise<string[]> {
    return (await nativeLookup(hostname)).map((a) => a.address);
  },
  reverse(): Promise<string[]> {
    return Promise.resolve([]);
  },
  setDefaultResultOrder(): void {},
};

export function lookup(hostname: string, ...rest: unknown[]): void {
  const cb = rest[rest.length - 1] as (
    err: Error | null,
    address?: unknown,
    family?: number,
  ) => void;
  const opts = (rest.length > 1 ? rest[0] : undefined) as LookupOpts | number | undefined;
  const o: LookupOpts = typeof opts === 'number' ? { family: opts } : (opts ?? {});
  nativeLookup(hostname, famNum(o.family)).then(
    (list) => {
      if (o.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    },
    (e: unknown) => {
      cb(e instanceof Error ? e : new Error(String(e)));
    },
  );
}

export function resolve4(
  hostname: string,
  cb: (err: Error | null, addrs?: string[]) => void,
): void {
  promises.resolve4(hostname).then(
    (a) => {
      cb(null, a);
    },
    (e: unknown) => {
      cb(e instanceof Error ? e : new Error(String(e)));
    },
  );
}

export function setDefaultResultOrder(): void {}
export function getServers(): string[] {
  return [];
}

export default { lookup, resolve4, promises, setDefaultResultOrder, getServers };
