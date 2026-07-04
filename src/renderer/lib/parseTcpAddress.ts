import { parseConnectHostPort } from '../../shared/connectHost';

export function parseTcpAddress(addr: string): { host: string; port: number } {
  return parseConnectHostPort(addr, 5000);
}
