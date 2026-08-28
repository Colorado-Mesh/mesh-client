import { ChevronLeft, ChevronRight, LogIn, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { isRrcWhisperRoom } from '@/renderer/lib/rrcMention';
import { rrcRoomMatchKey, rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import type { RrcListedRoom, RrcRoomInfo } from '@/shared/rrc-types';

function roomCollapsedLabel(name: string): string {
  const cleaned = name.replace(/^#/, '').trim();
  if (!cleaned) return '??';
  return cleaned.slice(0, 2).toUpperCase();
}

/** Prefer hub/joined spelling; collapse `#foo` / `foo` duplicates. */
function dedupeByMatchKey(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = rrcRoomMatchKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function dedupeJoinedRooms(joined: RrcRoomInfo[]): RrcRoomInfo[] {
  const byKey = new Map<string, RrcRoomInfo>();
  for (const room of joined) {
    const key = rrcRoomMatchKey(room.name);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, room);
      continue;
    }
    // Prefer the entry that already has members / topic.
    const prevScore = (prev.members?.length ?? 0) + (prev.topic ? 1 : 0);
    const nextScore = (room.members?.length ?? 0) + (room.topic ? 1 : 0);
    if (nextScore > prevScore) byKey.set(key, room);
  }
  return [...byKey.values()];
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
  recent: string[];
  activeRoom: string | null;
  unreadByRoom: Map<string, number>;
  onSelectRoom: (name: string, opts?: { join?: boolean }) => void;
  onToggleFavourite: (name: string) => void;
  onToggleAutoJoin: (name: string) => void;
  autoJoin: string[];
  /** Display labels for per-peer `@hash` DMs (match key → nick). */
  dmRoomLabels?: Map<string, string>;
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
  recent,
  activeRoom,
  unreadByRoom,
  onSelectRoom,
  onToggleFavourite,
  onToggleAutoJoin,
  autoJoin,
  dmRoomLabels,
}: RrcRoomSidebarProps) {
  const { t } = useTranslation();
  const q = roomSearch.trim().toLowerCase();
  const joinedDeduped = dedupeJoinedRooms(joined);
  const joinedKeys = new Set(joinedDeduped.map((r) => rrcRoomMatchKey(r.name)));
  const activeKey = activeRoom ? rrcRoomMatchKey(activeRoom) : null;

  const displayName = (name: string): string => {
    if (isRrcWhisperRoom(name)) {
      return dmRoomLabels?.get(rrcRoomMatchKey(name)) ?? name;
    }
    return name;
  };

  const filterName = (name: string) => {
    if (!q) return true;
    if (name.toLowerCase().includes(q)) return true;
    const label = displayName(name);
    if (label !== name && label.toLowerCase().includes(q)) return true;
    return false;
  };

  const unreadFor = (name: string): number => {
    const match = rrcRoomMatchKey(name);
    let total = 0;
    for (const [room, count] of unreadByRoom) {
      if (rrcRoomMatchKey(room) === match) total += count;
    }
    return total;
  };

  const renderRoomButton = (
    name: string,
    opts?: { unread?: number; joined?: boolean; topic?: string },
  ) => {
    const key = rrcRoomMatchKey(name);
    const selected = activeKey != null && activeKey === key;
    const unread = opts?.unread ?? 0;
    const label = displayName(name);
    const isWhisper = isRrcWhisperRoom(name);
    const isFav = favourites.some((f) => rrcRoomsMatch(f, name));
    const isAuto = autoJoin.some((a) => rrcRoomsMatch(a, name));

    if (collapsed) {
      return (
        <li key={key}>
          <button
            type="button"
            className={`relative flex w-full flex-col items-center gap-0.5 rounded px-1 py-1.5 ${
              selected
                ? 'border-bright-green bg-sidebar-active-bg border-l-2'
                : 'hover:bg-gray-800/60'
            }`}
            title={label}
            aria-label={t('rrc.selectRoom', { name: label })}
            onClick={() => {
              onSelectRoom(name, { join: opts?.joined === false });
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-800/80 text-[10px] font-semibold text-gray-100">
              {roomCollapsedLabel(label)}
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
            selected
              ? 'border-bright-green bg-sidebar-active-bg border-l-2 text-gray-100'
              : 'hover:bg-gray-800/60'
          }`}
        >
          <button
            type="button"
            className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
            aria-label={t('rrc.selectRoom', { name: label })}
            onClick={() => {
              onSelectRoom(name, { join: opts?.joined === false });
            }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{label}</span>
              {unread > 0 && !selected && (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
            {opts?.topic ? (
              <div className="text-muted truncate text-[10px]">{opts.topic}</div>
            ) : null}
          </button>
          {!isWhisper && (
            <>
              <button
                type="button"
                className={`shrink-0 p-1 ${isFav ? 'text-bright-green' : 'text-gray-500'}`}
                aria-label={isFav ? t('rrc.unfavoriteRoom') : t('rrc.favoriteRoom')}
                title={isFav ? t('rrc.unfavoriteRoom') : t('rrc.favoriteRoom')}
                onClick={() => {
                  onToggleFavourite(name);
                }}
              >
                <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                className={
                  isAuto
                    ? 'border-bright-green bg-readable-green shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold text-white'
                    : 'text-muted shrink-0 rounded border border-dashed border-gray-600 px-1.5 py-0.5 text-[9px] font-semibold hover:border-gray-500 hover:text-gray-300'
                }
                aria-label={isAuto ? t('rrc.disableAutoJoin') : t('rrc.enableAutoJoin')}
                aria-pressed={isAuto}
                title={isAuto ? t('rrc.roomAutoJoinOnHint') : t('rrc.roomAutoJoinOffHint')}
                onClick={() => {
                  onToggleAutoJoin(name);
                }}
              >
                A
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  const listedNotJoined = listed.filter(
    (r) => filterName(r.name) && !joinedKeys.has(rrcRoomMatchKey(r.name)),
  );
  const listedMatchKeys = new Set(listedNotJoined.map((r) => rrcRoomMatchKey(r.name)));
  const favNotJoined = dedupeByMatchKey(
    favourites.filter(
      (r) =>
        filterName(r) &&
        !joinedKeys.has(rrcRoomMatchKey(r)) &&
        !listedMatchKeys.has(rrcRoomMatchKey(r)),
    ),
  );
  const recentVisible = dedupeByMatchKey(
    recent.filter(
      (r) =>
        filterName(r) &&
        !joinedKeys.has(rrcRoomMatchKey(r)) &&
        !listedMatchKeys.has(rrcRoomMatchKey(r)) &&
        !favNotJoined.some((f) => rrcRoomsMatch(f, r)),
    ),
  );

  return (
    <aside
      className={`bg-secondary-dark/80 flex shrink-0 flex-col border-r border-gray-700 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-gray-700 p-2">
        {!collapsed && (
          <span className="text-xs font-semibold tracking-wide text-gray-200 uppercase">
            {t('rrc.rooms')}
          </span>
        )}
        <button
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-800/60"
          aria-label={collapsed ? t('rrc.expandRooms') : t('rrc.collapseRooms')}
          title={collapsed ? t('rrc.expandRooms') : t('rrc.collapseRooms')}
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
            className="bg-deep-black w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-100"
          />
          <p className="text-muted px-1 text-[10px] leading-snug">{t('rrc.roomLegend')}</p>
          <div className="flex gap-1">
            <input
              type="text"
              value={joinRoomName}
              onChange={(e) => {
                onJoinRoomNameChange(e.target.value);
              }}
              aria-label={t('rrc.joinRoom')}
              className="bg-deep-black min-w-0 flex-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-100"
            />
            <button
              type="button"
              className="bg-readable-green rounded px-2 py-1 text-xs text-white hover:opacity-90"
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
            className="bg-deep-black w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-100"
          />
          <button
            type="button"
            className="w-full rounded border border-gray-600 px-2 py-1 text-[10px] text-gray-400 hover:bg-gray-800/60"
            aria-label={t('rrc.refreshRoomList')}
            disabled={busy}
            onClick={onRefreshList}
          >
            {t('rrc.refreshRoomList')}
          </button>
          <p className="text-muted text-[10px] leading-snug">{t('rrc.listHint')}</p>
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {!collapsed && joinedDeduped.some((r) => filterName(r.name)) && (
          <li className="text-muted px-2 py-1 text-[10px] tracking-wide uppercase">
            {t('rrc.joinedRooms')}
          </li>
        )}
        {joinedDeduped
          .filter((r) => filterName(r.name))
          .map((room) =>
            renderRoomButton(room.name, {
              unread: unreadFor(room.name),
              joined: true,
              topic: room.topic ?? undefined,
            }),
          )}
        {!collapsed && (listedNotJoined.length > 0 || favNotJoined.length > 0) && (
          <li className="text-muted mt-2 px-2 py-1 text-[10px] tracking-wide uppercase">
            {t('rrc.listedRooms')}
          </li>
        )}
        {!collapsed &&
          listedNotJoined.map((r) =>
            renderRoomButton(r.name, {
              unread: unreadFor(r.name),
              joined: false,
              topic: r.topic,
            }),
          )}
        {!collapsed &&
          favNotJoined.map((name) =>
            renderRoomButton(name, { unread: unreadFor(name), joined: false }),
          )}
        {!collapsed && recentVisible.length > 0 && (
          <li className="text-muted mt-2 px-2 py-1 text-[10px] tracking-wide uppercase">
            {t('rrc.recentRooms')}
          </li>
        )}
        {!collapsed &&
          recentVisible.map((name) =>
            renderRoomButton(name, { unread: unreadFor(name), joined: false }),
          )}
        {joinedDeduped.length === 0 && !collapsed && (
          <li className="text-muted px-2 text-xs">{t('rrc.noRoomsJoined')}</li>
        )}
      </ul>
    </aside>
  );
}
