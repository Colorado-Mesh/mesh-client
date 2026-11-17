import { type ComponentProps, memo } from 'react';

import {
  useProtocolChatMessages,
  type UseProtocolChatMessagesOptions,
} from '../hooks/useProtocolChatMessages';
import type { IdentityId, MeshProtocol } from '../lib/types';
import ChatPanel from './ChatPanel';

type ChatPanelProps = ComponentProps<typeof ChatPanel>;

export interface ChatSurfaceProps extends Omit<ChatPanelProps, 'messages'> {
  protocol: MeshProtocol;
  identityId: IdentityId | null;
  chatOptions?: UseProtocolChatMessagesOptions;
}

/**
 * Owns store→UI message derivation for one protocol ChatPanel so AppContent does not
 * need to pass a `messages` array (and can eventually drop its own subscriptions).
 */
function ChatSurface({ protocol, identityId, chatOptions, ...panelProps }: ChatSurfaceProps) {
  const messages = useProtocolChatMessages(protocol, identityId, chatOptions);
  return (
    <ChatPanel {...panelProps} protocol={protocol} identityId={identityId} messages={messages} />
  );
}

export default memo(ChatSurface);
