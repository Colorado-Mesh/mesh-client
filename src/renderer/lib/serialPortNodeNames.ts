import { parseStoredJson } from './parseStoredJson';
import { loadLastSerialPortId } from './serialPortSignature';

export const SERIAL_PORT_NODE_NAMES_KEY = 'mesh-client:serialPortNodeNames';

/** Cached node name from a prior Meshtastic/MeshCore serial connection. */
export function getSerialPortNodeName(portId: string): string | null {
  const cache =
    parseStoredJson<Record<string, string>>(
      localStorage.getItem(SERIAL_PORT_NODE_NAMES_KEY),
      'serialPortNodeNames',
    ) ?? {};
  return cache[portId] ?? null;
}

export { loadLastSerialPortId };
