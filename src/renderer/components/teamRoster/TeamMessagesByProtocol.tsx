import type { ReactNode } from 'react';

import {
  type AllProtocolChatMessagesOptions,
  useAllProtocolChatMessages,
} from '@/renderer/hooks/useAllProtocolChatMessages';
import type { MessagesByProtocol } from '@/renderer/lib/teamRoster/contactMessageHistory';

export interface TeamMessagesByProtocolProps extends AllProtocolChatMessagesOptions {
  children: (messagesByProtocol: MessagesByProtocol) => ReactNode;
}

/**
 * Store→UI messages for team-like surfaces that do not already have App’s
 * `uiMessagesByProtocol`. Prefer passing that map from App when available.
 */
export function TeamMessagesByProtocol({ children, ...options }: TeamMessagesByProtocolProps) {
  const messagesByProtocol = useAllProtocolChatMessages(options);
  return <>{children(messagesByProtocol)}</>;
}
