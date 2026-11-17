import type { ReactNode } from 'react';

import {
  type AllProtocolChatMessagesOptions,
  useAllProtocolChatMessages,
} from '@/renderer/hooks/useAllProtocolChatMessages';
import type { MessagesByProtocol } from '@/renderer/lib/teamRoster/contactMessageHistory';

export interface TeamMessagesByProtocolProps extends AllProtocolChatMessagesOptions {
  children: (messagesByProtocol: MessagesByProtocol) => ReactNode;
}

/** Fetches store→UI messages for team panels so AppContent need not pass arrays. */
export function TeamMessagesByProtocol({ children, ...options }: TeamMessagesByProtocolProps) {
  const messagesByProtocol = useAllProtocolChatMessages(options);
  return <>{children(messagesByProtocol)}</>;
}
