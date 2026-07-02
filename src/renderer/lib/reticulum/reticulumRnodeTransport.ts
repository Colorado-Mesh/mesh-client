/** Default TCP port for RNode-over-IP (matches rsReticulum `rns-interface`). */
export const RNODE_DEFAULT_TCP_PORT = 7633;

/** RNode WiFi AP mode default gateway (upstream firmware). */
export const RNODE_AP_DEFAULT_HOST = '10.0.0.1';

const TCP_SCHEME = 'tcp://';

export type ReticulumRnodeTransportKind = 'serial' | 'ble' | 'wifi';

export function isReticulumTcpRnodeSerialPort(port: string | null | undefined): boolean {
  return typeof port === 'string' && port.trim().toLowerCase().startsWith(TCP_SCHEME);
}

export function parseReticulumRnodeTcpPort(uri: string): { host: string; port: number } | null {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith(TCP_SCHEME)) {
    return null;
  }
  const rest = trimmed.slice(TCP_SCHEME.length);
  if (!rest) {
    return null;
  }

  if (rest.startsWith('[')) {
    const closing = rest.indexOf(']');
    if (closing < 0) {
      return null;
    }
    const host = rest.slice(1, closing);
    const tail = rest.slice(closing + 1);
    if (!host) {
      return null;
    }
    if (!tail) {
      return { host, port: RNODE_DEFAULT_TCP_PORT };
    }
    if (!tail.startsWith(':')) {
      return null;
    }
    const port = Number.parseInt(tail.slice(1), 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host, port };
  }

  const colonCount = (rest.match(/:/g) ?? []).length;
  if (colonCount === 0) {
    return { host: rest, port: RNODE_DEFAULT_TCP_PORT };
  }
  if (colonCount === 1) {
    const sep = rest.lastIndexOf(':');
    const host = rest.slice(0, sep);
    const port = Number.parseInt(rest.slice(sep + 1), 10);
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host, port };
  }
  const sep = rest.lastIndexOf(':');
  const maybePort = rest.slice(sep + 1);
  const port = Number.parseInt(maybePort, 10);
  if (
    maybePort.length > 0 &&
    /^[0-9]+$/.test(maybePort) &&
    Number.isFinite(port) &&
    port > 255 &&
    port <= 65535
  ) {
    const host = rest.slice(0, sep);
    if (host) {
      return { host, port };
    }
  }
  return { host: rest, port: RNODE_DEFAULT_TCP_PORT };
}

export function buildReticulumRnodeTcpPort(host: string, port?: number): string {
  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return '';
  }
  const hostPart = trimmedHost.includes(':') ? `[${trimmedHost}]` : trimmedHost;
  const resolvedPort = port ?? RNODE_DEFAULT_TCP_PORT;
  if (resolvedPort === RNODE_DEFAULT_TCP_PORT) {
    return `${TCP_SCHEME}${hostPart}`;
  }
  return `${TCP_SCHEME}${hostPart}:${resolvedPort}`;
}

export function inferReticulumRnodeTransport(
  port: string | null | undefined,
): ReticulumRnodeTransportKind {
  if (isReticulumTcpRnodeSerialPort(port)) {
    return 'wifi';
  }
  if (typeof port === 'string' && port.trim().toLowerCase().startsWith('ble://')) {
    return 'ble';
  }
  return 'serial';
}
