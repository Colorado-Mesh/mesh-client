import {
  formatConnectHostLiteral,
  parseConnectHostPort,
  stripConnectHostBrackets,
} from '../../../shared/connectHost';

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

  const parsed = parseConnectHostPort(rest, RNODE_DEFAULT_TCP_PORT);
  if (!parsed.host) {
    return null;
  }
  return { host: stripConnectHostBrackets(parsed.host), port: parsed.port };
}

export function buildReticulumRnodeTcpPort(host: string, port?: number): string {
  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return '';
  }
  const hostPart = formatConnectHostLiteral(trimmedHost);
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
