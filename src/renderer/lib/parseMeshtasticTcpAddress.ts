import { parseConnectHostPort } from '../../shared/connectHost';

/** Default port for Meshtastic's native TCP streaming API. */
export const MESHTASTIC_TCP_DEFAULT_PORT = 4403;

export function parseMeshtasticTcpAddress(addr: string): { host: string; port: number } {
  return parseConnectHostPort(addr.trim(), MESHTASTIC_TCP_DEFAULT_PORT);
}
