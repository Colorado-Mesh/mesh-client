import { LogIn, Search, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import {
  isRrcByteLimitOverMax,
  RrcByteLimitHint,
} from '@/renderer/components/rrc/RrcByteLimitHint';
import { isRrcWhisperRoom } from '@/renderer/lib/rrcMention';
import { rrcRoomMatchKey, rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import type { RrcListedRoom, RrcRoomInfo } from '@/shared/rrc-types';

import { IconButton } from '../ui/Button';
import { chipClass, INPUT_CLASS } from '../ui/formClasses';

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

/** Room list body for the RRC list column (Refresh room list lives in the column header). */
export interface RrcRoomSidebarProps {
  roomSearch: string;
  onRoomSearchChange: (v: string) => void;
  joinRoomName: string;
  onJoinRoomNameChange: (v: string) => void;
  joinRoomKey: string;
  onJoinRoomKeyChange: (v: string) => void;
  /** Hub WELCOME max_room_name_bytes when known. */
  maxRoomNameBytes?: number | null;
  busy: boolean;
  onJoin: () => void;
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
  roomSearch,
  onRoomSearchChange,
  joinRoomName,
  onJoinRoomNameChange,
  joinRoomKey,
  onJoinRoomKeyChange,
  maxRoomNameBytes = null,
  busy,
  onJoin,
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

    return (
      <li key={key}>
        <div
          className={`flex items-center gap-1 rounded-lg pr-1 ${
            selected ? 'bg-sidebar-active-bg text-bright-green' : 'hover:bg-sidebar-active-bg/60'
          }`}
        >
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
            aria-label={t('rrc.selectRoom', { name: label })}
            onClick={() => {
              onSelectRoom(name, { join: opts?.joined === false });
            }}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{label}</span>
              {unread > 0 && !selected && (
                <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
            {opts?.topic ? <div className="text-muted truncate text-xs">{opts.topic}</div> : null}
          </button>
          {!isWhisper && (
            <>
              <button
                type="button"
                className={`shrink-0 rounded p-1 ${isFav ? 'text-bright-green' : 'text-muted hover:text-slate-200'}`}
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
                className={`${chipClass(isAuto, 'sm')} shrink-0`}
                aria-label={isAuto ? t('rrc.disableAutoJoin') : t('rrc.enableAutoJoin')}
                aria-pressed={isAuto}
                title={isAuto ? t('rrc.roomAutoJoinOnHint') : t('rrc.roomAutoJoinOffHint')}
                onClick={() => {
                  onToggleAutoJoin(name);
                }}
              >
                {t('rrc.autoJoinChip')}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search
            aria-hidden
            className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
            size={16}
          />
          <input
            type="search"
            value={roomSearch}
            onChange={(e) => {
              onRoomSearchChange(e.target.value);
            }}
            placeholder={t('rrc.searchRooms')}
            aria-label={t('rrc.searchRooms')}
            className={`${INPUT_CLASS} pl-8`}
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={joinRoomName}
            onChange={(e) => {
              onJoinRoomNameChange(e.target.value);
            }}
            placeholder={t('rrc.joinRoom')}
            aria-label={t('rrc.joinRoom')}
            className={INPUT_CLASS}
          />
          <IconButton
            variant="secondary"
            aria-label={t('rrc.join')}
            disabled={busy || isRrcByteLimitOverMax(joinRoomName, maxRoomNameBytes)}
            onClick={onJoin}
            icon={<LogIn aria-hidden className="h-4 w-4" size={16} />}
          />
        </div>
        <RrcByteLimitHint
          text={joinRoomName}
          limit={maxRoomNameBytes}
          overMaxKey="rrc.roomNameLimit.overMax"
        />
        <input
          type="password"
          value={joinRoomKey}
          onChange={(e) => {
            onJoinRoomKeyChange(e.target.value);
          }}
          placeholder={t('rrc.roomKeyOptional')}
          aria-label={t('rrc.roomKeyOptional')}
          className={INPUT_CLASS}
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {joinedDeduped.some((r) => filterName(r.name)) && (
          <li className="text-muted px-2 pt-3 pb-1 text-xs font-semibold">
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
        {(listedNotJoined.length > 0 || favNotJoined.length > 0) && (
          <li className="text-muted px-2 pt-3 pb-1 text-xs font-semibold">
            {t('rrc.listedRooms')}
          </li>
        )}
        {listedNotJoined.map((r) =>
          renderRoomButton(r.name, {
            unread: unreadFor(r.name),
            joined: false,
            topic: r.topic,
          }),
        )}
        {favNotJoined.map((name) =>
          renderRoomButton(name, { unread: unreadFor(name), joined: false }),
        )}
        {recentVisible.length > 0 && (
          <li className="text-muted px-2 pt-3 pb-1 text-xs font-semibold">
            {t('rrc.recentRooms')}
          </li>
        )}
        {recentVisible.map((name) =>
          renderRoomButton(name, { unread: unreadFor(name), joined: false }),
        )}
        {joinedDeduped.length === 0 && (
          <li className="text-muted px-2 py-2 text-xs">{t('rrc.noRoomsJoined')}</li>
        )}
      </ul>
      <div className="text-muted space-y-1 border-t border-slate-800 px-3 py-2 text-xs leading-snug">
        <p>{t('rrc.roomLegend')}</p>
        <p>{t('rrc.listHint')}</p>
      </div>
    </div>
  );
}
