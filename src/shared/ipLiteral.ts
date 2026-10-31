import { stripConnectHostBrackets } from './connectHost';

/**
 * IANA special-purpose / globally-reachable classification for SSRF guards.
 * Parity target: `ip-address` Address4/Address6 `.isGlobal()` (v10), including
 * IPv4-mapped (`::ffff:0:0/96`) and NAT64 well-known (`64:ff9b::/96`) delegation
 * to the embedded IPv4 predicate.
 */

interface Cidr4 {
  network: number;
  prefix: number;
  /** null = registry N/A (ignored when picking most-specific reachable). */
  reachable: boolean | null;
}

interface Cidr6 {
  networkHi: bigint;
  networkLo: bigint;
  prefix: number;
  reachable: boolean | null;
}

type Ipv4Octets = [number, number, number, number];
type Ipv6Hextets = [number, number, number, number, number, number, number, number];

function parseIpv4Octets(host: string): Ipv4Octets | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  const a = octets.at(0);
  const b = octets.at(1);
  const c = octets.at(2);
  const d = octets.at(3);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

function ipv4ToInt([a, b, c, d]: Ipv4Octets): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function splitCidr(cidr: string): { addr: string; prefix: number } | null {
  const slash = cidr.indexOf('/');
  if (slash <= 0) return null;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0) return null;
  return { addr: cidr.slice(0, slash), prefix };
}

function ipv4FromCidr(cidr: string): Cidr4 {
  const split = splitCidr(cidr);
  if (!split) throw new Error(`invalid v4 cidr ${cidr}`);
  const octets = parseIpv4Octets(split.addr);
  if (!octets) throw new Error(`invalid v4 cidr ${cidr}`);
  return {
    network: ipv4ToInt(octets),
    prefix: split.prefix,
    reachable: null,
  };
}

function ipv4InCidr(addr: number, network: number, prefix: number): boolean {
  if (prefix <= 0) return true;
  if (prefix >= 32) return addr === network;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (addr & mask) === (network & mask);
}

/** IANA IPv4 Special-Purpose Address Registry (reachable flag). */
const SPECIAL_PURPOSE_V4: Cidr4[] = (
  [
    ['0.0.0.0/8', false],
    ['0.0.0.0/32', false],
    ['10.0.0.0/8', false],
    ['100.64.0.0/10', false],
    ['127.0.0.0/8', false],
    ['169.254.0.0/16', false],
    ['172.16.0.0/12', false],
    ['192.0.0.0/24', false],
    ['192.0.0.0/29', false],
    ['192.0.0.8/32', false],
    ['192.0.0.9/32', true],
    ['192.0.0.10/32', true],
    ['192.0.0.170/32', false],
    ['192.0.0.171/32', false],
    ['192.0.2.0/24', false],
    ['192.31.196.0/24', true],
    ['192.52.193.0/24', true],
    ['192.88.99.0/24', null],
    ['192.88.99.2/32', false],
    ['192.168.0.0/16', false],
    ['192.175.48.0/24', true],
    ['198.18.0.0/15', false],
    ['198.51.100.0/24', false],
    ['203.0.113.0/24', false],
    ['240.0.0.0/4', false],
    ['255.255.255.255/32', false],
  ] as const
).map(([cidr, reachable]) => {
  const base = ipv4FromCidr(cidr);
  return { ...base, reachable };
});

const MULTICAST_V4_PREFIX = 4;
const MULTICAST_V4_NETWORK = ipv4ToInt([224, 0, 0, 0]);

function isGlobalIpv4Int(addr: number): boolean {
  if (ipv4InCidr(addr, MULTICAST_V4_NETWORK, MULTICAST_V4_PREFIX)) return false;
  let best: Cidr4 | null = null;
  for (const entry of SPECIAL_PURPOSE_V4) {
    if (entry.reachable === null) continue;
    if (!ipv4InCidr(addr, entry.network, entry.prefix)) continue;
    if (best === null || entry.prefix > best.prefix) best = entry;
  }
  return best === null ? true : best.reachable === true;
}

function parseHextet(part: string): number | null {
  if (part === '' || !/^[0-9a-f]{1,4}$/i.test(part)) return null;
  return Number.parseInt(part, 16);
}

/** Expand an IPv6 literal (incl. dotted-quad mapped / NAT64 forms) into 8 hextets. */
export function parseIpv6HextetsForLiteral(host: string): Ipv6Hextets | null {
  let normalized = stripConnectHostBrackets(host).toLowerCase();
  if (!normalized.includes(':')) return null;

  let embeddedV4Hextets: [number, number] | null = null;
  const lastColon = normalized.lastIndexOf(':');
  const after = normalized.slice(lastColon + 1);
  if (after.includes('.')) {
    const octets = parseIpv4Octets(after);
    if (!octets) return null;
    embeddedV4Hextets = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    // Dotted-quad consumes two hextet slots; keep a single placeholder token for counting.
    normalized = `${normalized.slice(0, lastColon)}:v4`;
  }

  const expandParts = (raw: string[]): string[] => {
    const out: string[] = [];
    for (const part of raw) {
      if (part === 'v4') {
        out.push('v4a', 'v4b');
        continue;
      }
      out.push(part);
    }
    return out;
  };

  let parts: string[];
  if (normalized.includes('::')) {
    const split = normalized.split('::');
    if (split.length !== 2) return null;
    const head = expandParts(split[0] ? split[0].split(':') : []);
    const tail = expandParts(split[1] ? split[1].split(':') : []);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    parts = [...head, ...Array.from({ length: missing }, () => '0'), ...tail];
  } else {
    const expanded = expandParts(normalized.split(':'));
    if (expanded.length !== 8) return null;
    parts = expanded;
  }

  if (parts.length !== 8) return null;
  const hextets: number[] = [];
  for (const part of parts) {
    if (part === 'v4a') {
      if (!embeddedV4Hextets) return null;
      hextets.push(embeddedV4Hextets[0]);
      continue;
    }
    if (part === 'v4b') {
      if (!embeddedV4Hextets) return null;
      hextets.push(embeddedV4Hextets[1]);
      continue;
    }
    const h = parseHextet(part);
    if (h === null) return null;
    hextets.push(h);
  }
  const h0 = hextets.at(0);
  const h1 = hextets.at(1);
  const h2 = hextets.at(2);
  const h3 = hextets.at(3);
  const h4 = hextets.at(4);
  const h5 = hextets.at(5);
  const h6 = hextets.at(6);
  const h7 = hextets.at(7);
  if (
    h0 === undefined ||
    h1 === undefined ||
    h2 === undefined ||
    h3 === undefined ||
    h4 === undefined ||
    h5 === undefined ||
    h6 === undefined ||
    h7 === undefined
  ) {
    return null;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

function hextetsToBigInts([h0, h1, h2, h3, h4, h5, h6, h7]: Ipv6Hextets): {
  hi: bigint;
  lo: bigint;
} {
  const hi = (BigInt(h0) << 48n) | (BigInt(h1) << 32n) | (BigInt(h2) << 16n) | BigInt(h3);
  const lo = (BigInt(h4) << 48n) | (BigInt(h5) << 32n) | (BigInt(h6) << 16n) | BigInt(h7);
  return { hi, lo };
}

function parseIpv6Cidr(cidr: string): Omit<Cidr6, 'reachable'> {
  const split = splitCidr(cidr);
  if (!split) throw new Error(`invalid v6 cidr ${cidr}`);
  const hextets = parseIpv6HextetsForLiteral(split.addr);
  if (!hextets) throw new Error(`invalid v6 cidr ${cidr}`);
  const { hi, lo } = hextetsToBigInts(hextets);
  return { networkHi: hi, networkLo: lo, prefix: split.prefix };
}

function ipv6InCidr(
  hi: bigint,
  lo: bigint,
  networkHi: bigint,
  networkLo: bigint,
  prefix: number,
): boolean {
  if (prefix <= 0) return true;
  if (prefix >= 128) return hi === networkHi && lo === networkLo;
  if (prefix <= 64) {
    const shift = BigInt(64 - prefix);
    const mask = ((1n << BigInt(prefix)) - 1n) << shift;
    return (hi & mask) === (networkHi & mask);
  }
  const loPrefix = prefix - 64;
  const loMask = ((1n << BigInt(loPrefix)) - 1n) << BigInt(64 - loPrefix);
  return hi === networkHi && (lo & loMask) === (networkLo & loMask);
}

const SPECIAL_PURPOSE_V6: Cidr6[] = (
  [
    ['::1/128', false],
    ['::/128', false],
    ['::ffff:0:0/96', false],
    ['64:ff9b::/96', true],
    ['64:ff9b:1::/48', false],
    ['100::/64', false],
    ['100:0:0:1::/64', false],
    ['2001::/23', false],
    ['2001::/32', false],
    ['2001:1::1/128', true],
    ['2001:1::2/128', true],
    ['2001:1::3/128', true],
    ['2001:2::/48', false],
    ['2001:3::/32', true],
    ['2001:4:112::/48', true],
    ['2001:10::/28', null],
    ['2001:20::/28', true],
    ['2001:30::/28', true],
    ['2001:db8::/32', false],
    ['2002::/16', false],
    ['2620:4f:8000::/48', true],
    ['3fff::/20', false],
    ['5f00::/16', false],
    ['fc00::/7', false],
    ['fe80::/10', false],
  ] as const
).map(([cidr, reachable]) => {
  const base = parseIpv6Cidr(cidr);
  return { ...base, reachable };
});

const GLOBAL_UNICAST_V6 = parseIpv6Cidr('2000::/3');
const MAPPED_V4_V6 = parseIpv6Cidr('::ffff:0:0/96');
const NAT64_WELL_KNOWN_V6 = parseIpv6Cidr('64:ff9b::/96');

function embeddedIpv4FromHextets(hextets: Ipv6Hextets): number | null {
  const { hi, lo } = hextetsToBigInts(hextets);
  const inMapped = ipv6InCidr(
    hi,
    lo,
    MAPPED_V4_V6.networkHi,
    MAPPED_V4_V6.networkLo,
    MAPPED_V4_V6.prefix,
  );
  const inNat64 = ipv6InCidr(
    hi,
    lo,
    NAT64_WELL_KNOWN_V6.networkHi,
    NAT64_WELL_KNOWN_V6.networkLo,
    NAT64_WELL_KNOWN_V6.prefix,
  );
  if (!inMapped && !inNat64) return null;
  return ((hextets[6] << 16) | hextets[7]) >>> 0;
}

function isGlobalIpv6Hextets(hextets: Ipv6Hextets): boolean {
  const embedded = embeddedIpv4FromHextets(hextets);
  if (embedded !== null) return isGlobalIpv4Int(embedded);

  const { hi, lo } = hextetsToBigInts(hextets);
  if (
    !ipv6InCidr(
      hi,
      lo,
      GLOBAL_UNICAST_V6.networkHi,
      GLOBAL_UNICAST_V6.networkLo,
      GLOBAL_UNICAST_V6.prefix,
    )
  ) {
    return false;
  }

  let best: Cidr6 | null = null;
  for (const entry of SPECIAL_PURPOSE_V6) {
    if (entry.reachable === null) continue;
    if (!ipv6InCidr(hi, lo, entry.networkHi, entry.networkLo, entry.prefix)) continue;
    if (best === null || entry.prefix > best.prefix) best = entry;
  }
  return best === null ? true : best.reachable === true;
}

/** True when `host` is a valid IPv4 literal (no brackets). */
export function isValidIpv4Literal(host: string): boolean {
  return parseIpv4Octets(stripConnectHostBrackets(host).trim()) !== null;
}

/** True when `host` is a valid IPv6 literal (bare or bracketed; dotted-quad mapped OK). */
export function isValidIpv6Literal(host: string): boolean {
  return parseIpv6HextetsForLiteral(host) !== null;
}

/** True when `host` is an IPv4 or IPv6 literal. */
export function isValidIpLiteral(host: string): boolean {
  const bare = stripConnectHostBrackets(host.trim()).toLowerCase();
  if (!bare) return false;
  if (bare.includes(':')) return isValidIpv6Literal(bare);
  return isValidIpv4Literal(bare);
}

/**
 * Whether an IP literal is globally reachable (IANA special-purpose registries).
 * Returns `null` when `host` is not an IP literal (e.g. a DNS name).
 */
export function isGlobalIpLiteral(host: string): boolean | null {
  const bare = stripConnectHostBrackets(host.trim()).toLowerCase();
  if (!bare) return null;
  if (bare.includes(':')) {
    const hextets = parseIpv6HextetsForLiteral(bare);
    if (!hextets) return null;
    return isGlobalIpv6Hextets(hextets);
  }
  const octets = parseIpv4Octets(bare);
  if (!octets) return null;
  return isGlobalIpv4Int(ipv4ToInt(octets));
}

/** Address family for a validated IP literal, else null. */
export function ipLiteralFamily(host: string): 4 | 6 | null {
  const bare = stripConnectHostBrackets(host.trim()).toLowerCase();
  if (!bare) return null;
  if (bare.includes(':')) return isValidIpv6Literal(bare) ? 6 : null;
  return isValidIpv4Literal(bare) ? 4 : null;
}
