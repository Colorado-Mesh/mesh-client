import type { ChatMessage } from '../types';

/** Visible MeshCom chat transport label (RF vs gateway). */
export function meshcomTransportBadgeText(
  via: NonNullable<ChatMessage['receivedVia']> | undefined,
): 'RF' | 'GW' {
  return via === 'network' ? 'GW' : 'RF';
}
