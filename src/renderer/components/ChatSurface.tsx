import { type ComponentProps, memo } from 'react';

import ChatPanel from './ChatPanel';

type ChatPanelProps = ComponentProps<typeof ChatPanel>;

export type ChatSurfaceProps = ChatPanelProps;

/**
 * Chat panel shell — message derivation runs once in App (`useProtocolChatMessages`);
 * this component receives the derived list to avoid duplicate store subscriptions.
 */
function ChatSurface(props: ChatSurfaceProps) {
  return <ChatPanel {...props} />;
}

export default memo(ChatSurface);
