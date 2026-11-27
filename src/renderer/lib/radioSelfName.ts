import { isPlaceholderLongName } from '@/shared/nodeNameUtils';

import type { MeshProtocol } from './types';

/** MeshCore self fallback when the companion has no advertised name (`Node-1A2B`). */
const MESHCORE_NODE_ID_NAME = /^Node-[0-9A-F]+$/;

/**
 * Long name suitable for a Saved devices row: trims, and rejects generated node-id
 * fallbacks so a hex id is never persisted as a radio name.
 *
 * BLE rows keep using the advertised device name (`bleDeviceName`); this helper is for
 * the radio's own name on serial and WiFi/HTTP/TCP/UDP/NetConsole endpoints.
 */
export function usableRadioLongName(
  longName: string | undefined | null,
  nodeId: number,
  protocol: MeshProtocol,
): string | undefined {
  const trimmed = longName?.trim() ?? '';
  if (!trimmed) return undefined;
  if (protocol === 'meshtastic' && nodeId > 0 && isPlaceholderLongName(trimmed, nodeId)) {
    return undefined;
  }
  if (protocol === 'meshcore' && MESHCORE_NODE_ID_NAME.test(trimmed)) return undefined;
  return trimmed;
}
