import os from 'os';

/** True for Node `networkInterfaces` family as string `'IPv4'` or numeric `4`. */
export function isIpv4Family(family: string | number): boolean {
  return family === 'IPv4' || family === 4;
}

/**
 * First non-internal IPv4 from `os.networkInterfaces()`, else `127.0.0.1`.
 * Used for TAK data-package connectString and server-cert SAN alignment.
 */
export function getLanIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const iface = ifaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (isIpv4Family(addr.family) && !addr.internal) {
        return addr.address;
      }
    }
  }
  console.warn('[TAK] No LAN IPv4 found, falling back to 127.0.0.1');
  return '127.0.0.1';
}
