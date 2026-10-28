import { useIdentityStore } from '../stores/identityStore';
import { useNodeStore } from '../stores/nodeStore';
import { parseChatMentionSegments } from './chatMentionSegments';
import type { MeshProtocol } from './types';

export type ChatNotificationMode = 'all' | 'mentions';
export const CHAT_NOTIFICATION_MODE_KEY = 'mesh-client:chatNotificationMode';
const listeners = new Set<() => void>();

export function getChatNotificationMode(): ChatNotificationMode {
  try {
    if (typeof window === 'undefined') return 'all';
    return localStorage.getItem(CHAT_NOTIFICATION_MODE_KEY) === 'mentions' ? 'mentions' : 'all';
  } catch (error) {
    console.debug('[chatNotificationPolicy] read failed', error);
    return 'all';
  }
}

export function saveChatNotificationMode(mode: ChatNotificationMode): boolean {
  try {
    localStorage.setItem(CHAT_NOTIFICATION_MODE_KEY, mode);
    for (const listener of listeners) listener();
    return true;
  } catch (error) {
    console.warn('[chatNotificationPolicy] save failed', error);
    return false;
  }
}

export function subscribeChatNotificationMode(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function getNotificationIdentity(protocol: MeshProtocol) {
  const { identities, activeIdentityId } = useIdentityStore.getState();
  const active = activeIdentityId ? identities[activeIdentityId] : undefined;
  return active?.protocol.type === protocol
    ? active
    : Object.values(identities).find((identity) => identity.protocol.type === protocol);
}

/** The composer sends bracket mentions, not substring matches or email addresses. */
function normalizedChatName(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

export function mentionsChatName(payload: string, names: readonly string[]): boolean {
  const ownNames = new Set(names.map(normalizedChatName).filter(Boolean));
  return parseChatMentionSegments(payload).some(
    (segment) => segment.kind === 'mention' && ownNames.has(normalizedChatName(segment.label)),
  );
}

export function mentionsLocalChatIdentity(
  payload: string,
  protocol: MeshProtocol,
  ownNodeIds: ReadonlySet<number> = new Set(),
  replyPreviewSender?: string,
): boolean {
  const identity = getNotificationIdentity(protocol);
  if (!identity) return false;
  const nodes = new Map(Object.entries(useNodeStore.getState().nodes)).get(identity.id);
  const names = [identity.displayName ?? '', identity.shortName ?? ''];
  const own = new Set(ownNodeIds);
  if (identity.selfNodeNum != null) own.add(identity.selfNodeNum);
  for (const nodeId of own) {
    const self = nodes?.[nodeId];
    if (self) names.push(self.longName ?? '', self.shortName ?? '');
  }
  // MeshCore's leading keyless reply token is parsed out of the displayed payload.
  return (
    mentionsChatName(payload, names) ||
    Boolean(
      replyPreviewSender?.trim() &&
      names.some((name) => normalizedChatName(name) === normalizedChatName(replyPreviewSender)),
    )
  );
}
