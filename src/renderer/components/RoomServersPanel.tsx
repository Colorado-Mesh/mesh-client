import { House, Server, Star } from 'lucide-react-motion';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { loadPersistedRoomsLastRead } from '@/renderer/lib/chatPanelProtocolStorage';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import {
  buildMeshcoreRoomMembershipContext,
  partitionMeshcoreRoomServers,
} from '@/renderer/lib/meshcoreRoomMembership';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';

import { buttonClassName } from './ui/Button';

export interface RoomServersPanelProps {
  nodes: Map<number, MeshNode>;
  messages: readonly ChatMessage[];
  onOpenRoom: (nodeId: number) => void;
  onToggleFavorite?: (nodeId: number, favorited: boolean) => void;
  isActive?: boolean;
}

/** Network directory of MeshCore room servers that are not yet joined/engaged. */
export default function RoomServersPanel({
  nodes,
  messages,
  onOpenRoom,
  onToggleFavorite,
}: RoomServersPanelProps) {
  const { t } = useTranslation();

  const discovered = useMemo(() => {
    const roomsLastRead = loadPersistedRoomsLastRead();
    const ctx = buildMeshcoreRoomMembershipContext({
      nodes: nodes.values(),
      messages,
      roomsLastRead,
    });
    const rooms = Array.from(nodes.values()).filter((n) => n.hw_model === 'Room');
    const { discovered: list } = partitionMeshcoreRoomServers(rooms, ctx);
    return list.sort((a, b) => {
      const aFav = a.favorited ? 1 : 0;
      const bFav = b.favorited ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return (a.long_name ?? '').localeCompare(b.long_name ?? '');
    });
  }, [messages, nodes]);

  return (
    <div data-panel-anchor="RoomServers" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-start gap-2">
        <Server aria-hidden className={`${ICON_MD} text-bright-green mt-0.5`} size={16} />
        <div className="min-w-0">
          <h2 className="text-ink-100 text-title font-semibold">{t('roomServers.title')}</h2>
          <p className="text-muted text-label mt-1">{t('roomServers.intro')}</p>
        </div>
      </div>

      {discovered.length === 0 ? (
        <p className="text-muted text-body rounded-card border-ink-700 border border-dashed px-3 py-6 text-center">
          {t('roomServers.empty')}
        </p>
      ) : (
        <ul className="border-ink-700 divide-ink-800 rounded-card divide-y overflow-y-auto border">
          {discovered.map((room) => {
            const name =
              room.long_name?.trim() || t('roomServers.unknownRoom', { id: room.node_id });
            const hops =
              typeof room.hops_away === 'number' && Number.isFinite(room.hops_away)
                ? room.hops_away
                : null;
            return (
              <li key={room.node_id} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="hover:bg-ink-800/60 rounded-control flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left"
                  aria-label={t('roomServers.openAria', { name })}
                  onClick={() => {
                    onOpenRoom(room.node_id);
                  }}
                >
                  <House aria-hidden className={`${ICON_MD} text-muted shrink-0`} size={16} />
                  <span className="text-body text-ink-100 min-w-0 truncate">{name}</span>
                  {hops != null ? (
                    <span className="text-muted text-label ml-auto shrink-0 tabular-nums">
                      {t('roomServers.hops', { count: hops })}
                    </span>
                  ) : null}
                </button>
                {onToggleFavorite ? (
                  <button
                    type="button"
                    className={buttonClassName('secondary', 'sm')}
                    aria-pressed={Boolean(room.favorited)}
                    aria-label={
                      room.favorited ? t('roomsPanel.unfavorite') : t('roomsPanel.favorite')
                    }
                    title={room.favorited ? t('roomsPanel.unfavorite') : t('roomsPanel.favorite')}
                    onClick={() => {
                      onToggleFavorite(room.node_id, !room.favorited);
                    }}
                  >
                    <Star
                      aria-hidden
                      className={`h-3.5 w-3.5 ${room.favorited ? 'fill-current text-yellow-400' : ''}`}
                      size={14}
                    />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
