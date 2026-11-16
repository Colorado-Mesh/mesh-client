import { Heart, MessageCircle, UserMinus } from 'lucide-react-motion';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { computeDmUnreadCounts } from '@/renderer/lib/chatUnreadCounts';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { nodeDisplayName } from '@/renderer/lib/nodeLongNameOrHex';
import type { ChatMessage, MeshNode, MeshProtocol } from '@/renderer/lib/types';
import { useFriendsStore } from '@/renderer/stores/friendsStore';

import { buttonClassName } from './ui/Button';

export interface FriendsPanelProps {
  protocol: MeshProtocol;
  identityId: string | null;
  nodes: Map<number, MeshNode>;
  messages: readonly ChatMessage[];
  ownNodeIds: ReadonlySet<number>;
  persistedLastRead: Readonly<Record<string, number>>;
  excludeDmPeer?: (peer: number) => boolean;
  onOpenDm: (nodeId: number) => void;
  isActive?: boolean;
}

/** Curated DM shortlist for the active protocol identity. */
export default function FriendsPanel({
  protocol,
  identityId,
  nodes,
  messages,
  ownNodeIds,
  persistedLastRead,
  excludeDmPeer,
  onOpenDm,
}: FriendsPanelProps) {
  const { t } = useTranslation();
  const byIdentity = useFriendsStore((s) => s.byIdentity);
  const removeFriend = useFriendsStore((s) => s.removeFriend);

  const friendIds = useMemo(() => {
    if (!identityId) return [] as number[];
    return byIdentity[identityId] ?? [];
  }, [byIdentity, identityId]);

  const dmUnread = useMemo(
    () =>
      computeDmUnreadCounts(messages, persistedLastRead, ownNodeIds, protocol, {
        excludeDmPeer,
      }),
    [excludeDmPeer, messages, ownNodeIds, persistedLastRead, protocol],
  );

  const rows = useMemo(() => {
    return friendIds
      .map((nodeId) => {
        const node = nodes.get(nodeId);
        const name = nodeDisplayName(node, protocol) || t('friends.unknownPeer', { id: nodeId });
        return {
          nodeId,
          name,
          unread: dmUnread.get(nodeId) ?? 0,
          missing: !node,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dmUnread, friendIds, nodes, protocol, t]);

  return (
    <div data-panel-anchor="Friends" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <Heart aria-hidden className={`${ICON_MD} text-bright-green mt-0.5`} size={16} />
        <div className="min-w-0">
          <h2 className="text-ink-100 text-title font-semibold">{t('friends.title')}</h2>
          <p className="text-muted text-label mt-1">{t('friends.intro')}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted text-body rounded-card border-ink-700 border border-dashed px-3 py-6 text-center">
          {t('friends.empty')}
        </p>
      ) : (
        <ul className="border-ink-700 divide-ink-800 rounded-card divide-y overflow-y-auto border">
          {rows.map((row) => (
            <li key={row.nodeId} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                className="hover:bg-ink-800/60 rounded-control flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left"
                aria-label={
                  row.unread > 0
                    ? t('friends.openDmWithUnread', { name: row.name, count: row.unread })
                    : t('friends.openDm', { name: row.name })
                }
                onClick={() => {
                  onOpenDm(row.nodeId);
                }}
              >
                <MessageCircle aria-hidden className={`${ICON_MD} text-muted shrink-0`} size={16} />
                <span
                  className={`text-body min-w-0 truncate ${row.missing ? 'text-muted' : 'text-ink-100'}`}
                >
                  {row.name}
                </span>
                {row.unread > 0 ? (
                  <span className="text-2xs ml-auto inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded-full bg-red-600 px-0.5 font-semibold text-white">
                    {row.unread > 99 ? '99+' : row.unread}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={buttonClassName('secondary', 'sm')}
                aria-label={t('friends.removeAria', { name: row.name })}
                title={t('friends.remove')}
                onClick={() => {
                  if (identityId) removeFriend(identityId, row.nodeId);
                }}
              >
                <UserMinus aria-hidden className={ICON_MD} size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
