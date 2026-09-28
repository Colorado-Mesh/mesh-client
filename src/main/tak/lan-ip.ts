import os from 'os';

/** True for Node `networkInterfaces` family as string `'IPv4'` or numeric `4`. */
export function isIpv4Family(family: string | number): boolean {
  return family === 'IPv4' || family === 4;
}

/**
 * Virtual / VPN interface names that must not own the TAK server-cert identity.
 * `docker0` is exact; the rest are prefixes (`br-*`, `veth*`, `tun*`, …).
 */
const VIRTUAL_INTERFACE_PREFIXES = [
  'br-',
  'veth',
  'virbr',
  'vboxnet',
  'vmnet',
  'utun',
  'tun',
  'tap',
  'wg',
  'tailscale',
  'zt',
] as const;

interface LanIpv4Candidate {
  name: string;
  address: string;
}

function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isVirtualOrVpnInterface(name: string): boolean {
  const normalized = name.toLowerCase();
  if (normalized === 'docker0') return true;
  return VIRTUAL_INTERFACE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function ipv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const part = parts[i] ?? '';
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets[i] = n;
  }
  return octets;
}

/** 169.254.0.0/16 (APIPA). Not a stable LAN identity. */
function isLinkLocalIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  return octets !== null && octets[0] === 169 && octets[1] === 254;
}

/** 10/8, 172.16/12, 192.168/16. */
function isRfc1918Ipv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const a = octets[0];
  const b = octets[1];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPreferredPhysicalLan(candidate: LanIpv4Candidate): boolean {
  return (
    !isVirtualOrVpnInterface(candidate.name) &&
    !isLinkLocalIpv4(candidate.address) &&
    isRfc1918Ipv4(candidate.address)
  );
}

/**
 * Non-internal IPv4 addresses in interface-name order, then address order.
 * Enumeration order from the OS is not stable enough for a cert identity.
 */
function listNonInternalIpv4(): LanIpv4Candidate[] {
  const ifaces = os.networkInterfaces();
  const candidates: LanIpv4Candidate[] = [];
  for (const name of Object.keys(ifaces).sort(compareAscii)) {
    const iface = ifaces[name];
    if (!iface) continue;
    const addresses: string[] = [];
    for (const addr of iface) {
      if (isIpv4Family(addr.family) && !addr.internal) {
        addresses.push(addr.address);
      }
    }
    addresses.sort(compareAscii);
    for (const address of addresses) {
      candidates.push({ name, address });
    }
  }
  return candidates;
}

/**
 * LAN IPv4 for the TAK data-package connectString and server-cert SAN.
 *
 * Prefers an RFC1918 address on a physical interface, skipping internal,
 * link-local, and known virtual/VPN names. Falls back to the first
 * non-internal IPv4 only when nothing qualifies, then `127.0.0.1`.
 */
export function getLanIp(): string {
  const candidates = listNonInternalIpv4();
  const selected = candidates.find(isPreferredPhysicalLan) ?? candidates[0];
  if (selected) return selected.address;
  console.warn('[TAK] No LAN IPv4 found, falling back to 127.0.0.1');
  return '127.0.0.1';
}
