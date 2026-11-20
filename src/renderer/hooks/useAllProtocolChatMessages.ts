import { useMemo } from 'react';

import type { ChannelRemapContext } from '../lib/remapChannelMessagesToLiveSlots';
import type { ChatMessage, IdentityId, MeshProtocol } from '../lib/types';
import { REGISTERED_MESH_PROTOCOLS } from '../lib/types';
import { useProtocolChatMessages } from './useProtocolChatMessages';

export interface AllProtocolChatMessagesOptions {
  identityIdByProtocol: Record<MeshProtocol, IdentityId | null>;
  meshtasticRemap?: ChannelRemapContext | null;
  meshcoreRemap?: ChannelRemapContext | null;
  meshcoreSelfNodeId?: number;
}

/** Store→UI messages for all three protocols (for team roster / unified inbox / notifiers). */
export function useAllProtocolChatMessages(
  options: AllProtocolChatMessagesOptions,
): Record<MeshProtocol, ChatMessage[]> {
  const meshtastic = useProtocolChatMessages(
    'meshtastic',
    options.identityIdByProtocol.meshtastic,
    { remap: options.meshtasticRemap },
  );
  const meshcore = useProtocolChatMessages('meshcore', options.identityIdByProtocol.meshcore, {
    remap: options.meshcoreRemap,
    meshcoreSelfNodeId: options.meshcoreSelfNodeId,
  });
  const reticulum = useProtocolChatMessages('reticulum', options.identityIdByProtocol.reticulum);
  const meshcom = useProtocolChatMessages('meshcom', options.identityIdByProtocol.meshcom);
  return useMemo(
    () => ({ meshtastic, meshcore, reticulum, meshcom }),
    [meshtastic, meshcore, reticulum, meshcom],
  );
}

/** Stable empty record for inactive panels. */
export const EMPTY_MESSAGES_BY_PROTOCOL: Record<MeshProtocol, ChatMessage[]> = Object.fromEntries(
  REGISTERED_MESH_PROTOCOLS.map((p) => [p, [] as ChatMessage[]]),
) as Record<MeshProtocol, ChatMessage[]>;
