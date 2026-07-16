import { ChevronLeft, ChevronRight, LogIn, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import type { RrcListedRoom, RrcRoomInfo } from '@/shared/rrc-types';

function roomCollapsedLabel(name: string): string {
  const cleaned = name.replace(/^#/, '').trim();
  if (!cleaned) return '??';
  return cleaned.slice(0, 2).toUpperCase();
}

export interface RrcRoomSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  roomSearch: string;
  onRoomSearchChange: (v: string) => void;
  joinRoomName: string;
  onJoinRoomNameChange: (v: string) => void;
  joinRoomKey: string;
  onJoinRoomKeyChange: (v: string) => void;
  busy: boolean;
  onJoin: () => void;
  onRefreshList: () => void;
  joined: RrcRoomInfo[];
  listed: RrcListedRoom[];
  favourites: string[];
  suggested: string[];
  recent: string[];
  activeRoom: string | null;
  unreadByRoom: Map<string, number>;
  onSelectRoom: (name: string, opts?: { join?: boolean }) => void;
  onToggleFavourite: (name: string) => void;
  onToggleAutoJoin: (name: string) => void;
  autoJoin: string[];
}

export function RrcRoomSidebar({
  collapsed,
  onToggleCollapsed,
  roomSearch,
  onRoomSearchChange,
  joinRoomName,
  onJoinRoomNameChange,
  joinRoomKey,
  onJoinRoomKeyChange,
  busy,
  onJoin,
  onRefreshList,
  joined,
  listed,
  favourites,
  suggested,
  recent,
  activeRoom,
  unreadByRoom,
  onSelectRoom,
  onToggleFavourite,
  onToggleAutoJoin,
  autoJoin,
}: RrcRoomSidebarProps) {
  const { t } = useTranslation();
  const q = roomSearch.trim().toLowerCase();
  const joinedKeys = new Set(joined.map((r) => r.name.trim().toLowerCase()));

  const filterName = (name: string) => !q || name.toLowerCase().includes(q);

  const renderRoomButton = (
    name: string,
    opts?: { unread?: number; joined?: boolean; topic?: string },
  ) => {
    const key = name.trim().toLowerCase();
    const selected = activeRoom === key;
    const unread = opts?.unread ?? 0;
    const isFav = favourites.includes(key);
    const isAuto = autoJoin.includes(key);

    if (collapsed) {
      return (
        <li key={key}>
          <button
            type="button"
            className={`relative flex w-full flex-col items-center gap-0.5 rounded px-1 py-1.5 ${
              selected ? 'border-l-2 border-amber-400 bg-amber-950/40' : 'hover:bg-amber-950/25'
            }`}
            title={name}
            aria-label={t('rrc.selectRoom', { name })}
            onClick={() => {
              onSelectRoom(name, { join: opts?.joined === false });
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-950/60 text-[10px] font-semibold text-amber-100">
              {roomCollapsedLabel(name)}
            </span>
            {unread > 0 && !selected && (
              <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-600" />
            )}
          </button>
        </li>
      );
    }

    return (
      <li key={key}>
        <div
          className={`flex items-center gap-0.5 rounded ${
            selected ? 'bg-amber-950/50 text-amber-50' : 'hover:bg-amber-950/25'
          }`}
        >
          <button
            type="button"
            className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
            aria-label={t('rrc.selectRoom', { name })}
            onClick={() => {
              onSelectRoom(name, { join: opts?.joined === false });
            }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{name}</span>
              {unread > 0 && !selected && (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
            {opts?.topic ? (
              <div className="truncate text-[10px] text-amber-200/40">{opts.topic}</div>
            ) : null}
          </button>
          <button
            type="button"
            className={`shrink-0 p-1 ${isFav ? 'text-amber-400' : 'text-amber-200/30'}`}
            aria-label={isFav ? t('rrc.unfavoriteRoom') : t('rrc.favoriteRoom')}
            onClick={() => {
              onToggleFavourite(name);
            }}
          >
            <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={`shrink-0 px-1 text-[9px] ${isAuto ? 'text-amber-300' : 'text-amber-200/30'}`}
            aria-label={isAuto ? t('rrc.disableAutoJoin') : t('rrc.enableAutoJoin')}
            title={t('rrc.autoJoin')}
            onClick={() => {
              onToggleAutoJoin(name);
            }}
          >
            A
          </button>
        </div>
      </li>
    );
  };

  const listedNotJoined = listed.filter(
    (r) => filterName(r.name) && !joinedKeys.has(r.name.trim().toLowerCase()),
  );
  const favNotJoined = favourites.filter(
    (r) => filterName(r) && !joinedKeys.has(r) && !listedNotJoined.some((l) => l.name === r),
  );

  return (
    <aside
      className={`bg-secondary-dark/80 flex shrink-0 flex-col border-r border-amber-800/40 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-amber-800/40 p-2">
        {!collapsed && (
          <span className="text-xs font-semibold tracking-wide text-amber-400/80 uppercase">
            {t('rrc.rooms')}
          </span>
        )}
        <button
          type="button"
          className="rounded p-1 text-amber-200/80 hover:bg-amber-950/50"
          aria-label={collapsed ? t('rrc.expandRooms') : t('rrc.collapseRooms')}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-2 p-2">
          <input
            type="search"
            value={roomSearch}
            onChange={(e) => {
              onRoomSearchChange(e.target.value);
            }}
            placeholder={t('rrc.searchRooms')}
            aria-label={t('rrc.searchRooms')}
            className="w-full rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 text-xs text-amber-50"
          />
          <div className="flex gap-1">
            <input
              type="text"
              value={joinRoomName}
              onChange={(e) => {
                onJoinRoomNameChange(e.target.value);
              }}
              aria-label={t('rrc.joinRoom')}
              className="min-w-0 flex-1 rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 text-xs text-amber-50"
            />
            <button
              type="button"
              className="rounded bg-amber-800/80 px-2 py-1 text-xs text-amber-50"
              aria-label={t('rrc.join')}
              disabled={busy}
              onClick={onJoin}
            >
              <LogIn size={14} />
            </button>
          </div>
          <input
            type="password"
            value={joinRoomKey}
            onChange={(e) => {
              onJoinRoomKeyChange(e.target.value);
            }}
            placeholder={t('rrc.roomKeyOptional')}
            aria-label={t('rrc.roomKeyOptional')}
            className="w-full rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 text-xs text-amber-50"
          />
          <button
            type="button"
            className="w-full rounded border border-amber-800/40 px-2 py-1 text-[10px] text-amber-200/70 hover:bg-amber-950/40"
            aria-label={t('rrc.refreshRoomList')}
            disabled={busy}
            onClick={onRefreshList}
          >
            {t('rrc.refreshRoomList')}
          </button>
          <p className="text-[10px] leading-snug text-amber-200/40">{t('rrc.listHint')}</p>
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {!collapsed && joined.filter((r) => filterName(r.name)).length > 0 && (
          <li className="px-2 py-1 text-[10px] tracking-wide text-amber-500/70 uppercase">
            {t('rrc.joinedRooms')}
          </li>
        )}
        {joined
          .filter((r) => filterName(r.name))
          .map((room) =>
            renderRoomButton(room.name, {
              unread: unreadByRoom.get(room.name.trim().toLowerCase()) ?? 0,
              joined: true,
              topic: room.topic ?? undefined,
            }),
          )}
        {!collapsed && (listedNotJoined.length > 0 || favNotJoined.length > 0) && (
          <li className="mt-2 px-2 py-1 text-[10px] tracking-wide text-amber-500/70 uppercase">
            {t('rrc.listedRooms')}
          </li>
        )}
        {listedNotJoined.map((r) => renderRoomButton(r.name, { joined: false, topic: r.topic }))}
        {favNotJoined.map((name) => renderRoomButton(name, { joined: false }))}
        {!collapsed && suggested.filter(filterName).length > 0 && (
          <li className="mt-2 px-2 py-1 text-[10px] tracking-wide text-amber-500/70 uppercase">
            {t('rrc.suggestedRooms')}
          </li>
        )}
        {suggested.filter(filterName).map((name) => renderRoomButton(name, { joined: false }))}
        {!collapsed && recent.filter(filterName).length > 0 && (
          <li className="mt-2 px-2 py-1 text-[10px] tracking-wide text-amber-500/70 uppercase">
            {t('rrc.recentRooms')}
          </li>
        )}
        {recent.filter(filterName).map((name) => renderRoomButton(name, { joined: false }))}
        {joined.length === 0 && !collapsed && (
          <li className="px-2 text-xs text-amber-200/40">{t('rrc.noRoomsJoined')}</li>
        )}
      </ul>
    </aside>
  );
}
