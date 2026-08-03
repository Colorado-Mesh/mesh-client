import { TCP_PORT_MAX, TCP_PORT_MIN } from './tcpPort';

/** Strip surrounding `[` `]` from an IPv6 literal host. */
export function stripConnectHostBrackets(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isValidDnsLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith('-') || label.endsWith('-')) return false;
  return /^[a-zA-Z0-9-]+$/.test(label);
}

function isValidDnsHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.some((label) => label.length === 0)) return false;
  return labels.every(isValidDnsLabel);
}

function parseIpv4Octets(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isValidIpv4Literal(host: string): boolean {
  return parseIpv4Octets(host) !== null;
}

/** Expand an IPv6 literal into eight 16-bit hextets, or null when invalid. */
function parseIpv6Hextets(host: string): number[] | null {
  const normalized = stripConnectHostBrackets(host).toLowerCase();
  if (!normalized.includes(':')) return null;

  let head: string[];
  let tail: string[];
  if (normalized.includes('::')) {
    const parts = normalized.split('::');
    if (parts.length !== 2) return null;
    head = parts[0] ? parts[0].split(':') : [];
    tail = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const zeroFill = Array.from({ length: missing }, (): string => '0');
    const expanded = [...head, ...zeroFill, ...tail];
    return hextetsFromParts(expanded);
  }

  const split = normalized.split(':');
  if (split.length !== 8) return null;
  return hextetsFromParts(split);
}

function hextetsFromParts(parts: string[]): number[] | null {
  const hextets: number[] = [];
  for (const part of parts) {
    if (part === '' || !/^[0-9a-f]{1,4}$/i.test(part)) return null;
    hextets.push(Number.parseInt(part, 16));
  }
  return hextets.length === 8 ? hextets : null;
}

function isValidIpv6Literal(host: string): boolean {
  return parseIpv6Hextets(host) !== null;
}

/** Hostname validation for HTTP/TCP connect: DNS labels, IPv4, or IPv6 (bare or bracketed, no port). */
export function isValidConnectHost(host: string): boolean {
  const trimmed = host.trim();
  if (trimmed.length === 0) return false;
  const bare = stripConnectHostBrackets(trimmed);
  if (bare.includes(':')) return isValidIpv6Literal(bare);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bare)) return isValidIpv4Literal(bare);
  return isValidDnsHostname(bare);
}

/** RFC1918 private IPv4 ranges. */
export function isPrivateNetworkHost(host: string): boolean {
  const octets = parseIpv4Octets(stripConnectHostBrackets(host));
  if (!octets) return false;
  const a = octets.at(0);
  const b = octets.at(1);
  if (a === undefined || b === undefined) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** RFC4193 unique local IPv6 (fc00::/7). */
export function isUniqueLocalIpv6(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return false;
  const firstHextet = hextets.at(0);
  if (firstHextet === undefined) return false;
  const firstByte = firstHextet >> 8;
  return firstByte === 0xfc || firstByte === 0xfd;
}

/** IPv6 link-local (fe80::/10). */
export function isLinkLocalIpv6(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return false;
  const firstHextet = hextets.at(0);
  return firstHextet !== undefined && (firstHextet & 0xffc0) === 0xfe80;
}

/** IPv4 loopback (127.0.0.0/8) or IPv6 loopback (::1). */
export function isLoopbackHost(host: string): boolean {
  const bare = stripConnectHostBrackets(host).toLowerCase();
  if (bare === '::1') return true;
  const octets = parseIpv4Octets(bare);
  return octets !== null && octets[0] === 127;
}

/**
 * mDNS / Bonjour hostnames only (*.local, meshtastic.local).
 * Do not fold into isLocalConnectHost for UI error copy — #610 did that and attached
 * Bonjour/meshtastic.local hints to bare private IPs (e.g. MeshCore TCP 192.168.x.x).
 * Keep private/ULA/loopback locality on isLocalConnectHost for SSRF / RNode primary.
 */
export function isMdnsConnectHost(host: string): boolean {
  const normalized = stripConnectHostBrackets(host.trim()).toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'meshtastic.local' ||
    normalized.endsWith('.meshtastic.local') ||
    normalized.endsWith('.local')
  );
}

/**
 * Local connect targets: RFC1918, RFC4193 ULA, link-local, loopback, mDNS.
 * For Connection-panel Bonjour/mDNS hint copy, use isMdnsConnectHost — not this.
 */
export function isLocalConnectHost(host: string): boolean {
  const bare = stripConnectHostBrackets(host.trim()).toLowerCase();
  if (!bare) return false;
  if (isMdnsConnectHost(bare)) return true;
  if (isLoopbackHost(bare)) return true;
  if (isPrivateNetworkHost(bare)) return true;
  if (isUniqueLocalIpv6(bare)) return true;
  if (isLinkLocalIpv6(bare)) return true;
  return false;
}

function hostContainsIpv6(host: string): boolean {
  const bare = stripConnectHostBrackets(host);
  if (isValidIpv4Literal(bare)) return false;
  return bare.includes(':') && isValidIpv6Literal(bare);
}

/** Canonical host string for URL authority (includes port when provided). */
export function formatHostForUrl(host: string, port?: number): string {
  const bare = stripConnectHostBrackets(host.trim());
  const hostPart = hostContainsIpv6(bare) ? `[${bare}]` : bare;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (port === undefined || port === null) return hostPart;
  return `${hostPart}:${port}`;
}

/** Unbracketed host for net.Socket.connect. */
export function formatHostForSocket(host: string): string {
  return stripConnectHostBrackets(host.trim());
}

function parseTrailingPort(value: string): number | null {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < TCP_PORT_MIN || port > TCP_PORT_MAX) return null;
  return port;
}

/**
 * Parse user-entered host[:port] or [ipv6]:port.
 * Always returns an unbracketed host.
 */
export function parseConnectHostPort(
  input: string,
  defaultPort: number,
): { host: string; port: number } {
  let addr = input.trim();
  addr = addr.replace(/^https?:\/\//i, '');
  addr = addr.replace(/\/+$/, '');

  if (!addr) {
    return { host: '', port: defaultPort };
  }

  if (addr.startsWith('[')) {
    const closing = addr.indexOf(']');
    if (closing >= 0) {
      const host = stripConnectHostBrackets(addr.slice(0, closing + 1));
      const tail = addr.slice(closing + 1);
      if (!tail) {
        return { host, port: defaultPort };
      }
      if (tail.startsWith(':')) {
        const port = parseTrailingPort(tail.slice(1));
        if (port !== null) {
          return { host, port };
        }
      }
      return { host, port: defaultPort };
    }
  }

  const colonCount = (addr.match(/:/g) ?? []).length;
  if (colonCount >= 2) {
    const sep = addr.lastIndexOf(':');
    const maybePort = addr.slice(sep + 1);
    const port = parseTrailingPort(maybePort);
    if (port !== null && maybePort.length > 0 && /^\d+$/.test(maybePort) && port > 255) {
      const host = addr.slice(0, sep);
      if (host) {
        return { host, port };
      }
    }
    return { host: addr, port: defaultPort };
  }

  const colonIdx = addr.lastIndexOf(':');
  if (colonIdx > 0) {
    const port = parseTrailingPort(addr.slice(colonIdx + 1));
    if (port !== null) {
      return { host: addr.slice(0, colonIdx), port };
    }
  }

  return { host: addr, port: defaultPort };
}

/** Bracket IPv6 literals for INI / tcp:// URI host segments. */
export function formatConnectHostLiteral(host: string): string {
  const bare = stripConnectHostBrackets(host.trim());
  if (!bare) return '';
  return hostContainsIpv6(bare) ? `[${bare}]` : bare;
}
