import { ChevronLeft, ChevronRight, RefreshCw, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { resolveRrcHubSidebarMarker, type RrcHubSidebarMarker } from '@/renderer/lib/rrcHubPrefs';
import type { RrcHubInfo } from '@/shared/rrc-types';

function formatHash(hash: string): string {
  return hash.slice(0, 8);
}

export interface RrcHubBrowserProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sidecarRunning: boolean;
  hubSearch: string;
  onHubSearchChange: (v: string) => void;
  nickname: string;
  onNicknameChange: (v: string) => void;
  favourites: RrcHubInfo[];
  discovered: RrcHubInfo[];
  hubDestHash: string | null;
  /** Unread count per hub destination hash (lowercase keys preferred). */
  unreadForHub: (hubHash: string) => number;
  /** Session status per hub (active/connecting/…). */
  statusForHub: (hubHash: string) => string | null;
  /** Whether hub is in the auto-join list. */
  isHubAutoJoin: (hubHash: string) => boolean;
  manualHash: string;
  onManualHashChange: (v: string) => void;
  hubTab: 'favourites' | 'discovered';
  onHubTabChange: (tab: 'favourites' | 'discovered') => void;
  onRefresh: () => void;
  onConnect: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
  onToggleAutoJoin: (hash: string) => void;
  onManualConnect: () => void;
}

function HubRow({
  hub,
  selected,
  sidecarRunning,
  unread,
  marker,
  autoJoin,
  onConnect,
  onToggleFavorite,
  onToggleAutoJoin,
}: {
  hub: RrcHubInfo;
  selected: boolean;
  sidecarRunning: boolean;
  unread: number;
  marker: RrcHubSidebarMarker;
  autoJoin: boolean;
  onConnect: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
  onToggleAutoJoin: (hash: string) => void;
}) {
  const { t } = useTranslation();
  const label = hub.display_name?.trim() || formatHash(hub.destination_hash);
  const secondary = hub.display_name?.trim() ? formatHash(hub.destination_hash) : null;
  const markerTitle =
    marker.kind === 'connected'
      ? t('rrc.hubMarker.connected')
      : marker.kind === 'connecting'
        ? t('rrc.hubMarker.connecting')
        : marker.kind === 'autoJoinNotConnected'
          ? t('rrc.hubMarker.autoJoin')
          : t('rrc.hubMarker.idle');

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm ${
          selected ? 'border-bright-green bg-sidebar-active-bg border-l-2' : 'hover:bg-gray-800/60'
        }`}
      >
        <span className={`shrink-0 text-xs ${marker.colorClass}`} title={markerTitle} aria-hidden>
          {marker.glyph}
        </span>
        <button
          type="button"
          className="relative min-w-0 flex-1 text-left"
          aria-label={
            unread > 0
              ? t('rrc.selectHubUnread', {
                  name: label,
                  marker: markerTitle,
                  count: unread > 99 ? '99+' : unread,
                })
              : `${t('rrc.selectHub', { name: label })} ${markerTitle}`
          }
          onClick={() => {
            onConnect(hub.destination_hash);
          }}
          // Focus-only for already-linked hubs even if the stack status poll is stale.
          disabled={!sidecarRunning && marker.kind !== 'connected' && marker.kind !== 'connecting'}
        >
          <div className="flex items-center justify-between gap-1">
            <div className="truncate font-medium text-gray-100">{label}</div>
            {unread > 0 && (
              <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-gray-400">
            {secondary ?? formatHash(hub.destination_hash)}
            {hub.hops != null ? ` · ${t('rrc.hopsAway', { count: hub.hops })}` : ''}
            {hub.user_count != null ? ` · ${t('rrc.userCount', { count: hub.user_count })}` : ''}
          </div>
          {hub.description ? (
            <div className="text-muted truncate text-[10px]">{hub.description}</div>
          ) : null}
        </button>
        <button
          type="button"
          className={
            autoJoin
              ? 'border-bright-green bg-readable-green shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold text-white'
              : 'text-muted shrink-0 rounded border border-dashed border-gray-600 px-1.5 py-0.5 text-[10px] font-semibold hover:border-gray-500 hover:text-gray-300'
          }
          aria-label={autoJoin ? t('rrc.disableHubAutoJoin') : t('rrc.enableHubAutoJoin')}
          aria-pressed={autoJoin}
          title={autoJoin ? t('rrc.hubAutoJoinOnHint') : t('rrc.hubAutoJoinOffHint')}
          onClick={() => {
            onToggleAutoJoin(hub.destination_hash);
          }}
        >
          A
        </button>
        <button
          type="button"
          className={`shrink-0 p-1 ${hub.favorited ? 'text-bright-green' : 'text-gray-500'}`}
          aria-label={hub.favorited ? t('rrc.unfavoriteHub') : t('rrc.favoriteHub')}
          title={hub.favorited ? t('rrc.unfavoriteHub') : t('rrc.favoriteHub')}
          onClick={() => {
            onToggleFavorite(hub.destination_hash, !hub.favorited);
          }}
        >
          <Star size={14} fill={hub.favorited ? 'currentColor' : 'none'} />
        </button>
      </div>
    </li>
  );
}

function HubList({
  rows,
  hubDestHash,
  sidecarRunning,
  unreadForHub,
  statusForHub,
  isHubAutoJoin,
  onConnect,
  onToggleFavorite,
  onToggleAutoJoin,
}: {
  rows: RrcHubInfo[];
  hubDestHash: string | null;
  sidecarRunning: boolean;
  unreadForHub: (hubHash: string) => number;
  statusForHub: (hubHash: string) => string | null;
  isHubAutoJoin: (hubHash: string) => boolean;
  onConnect: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
  onToggleAutoJoin: (hash: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {rows.map((hub) => {
        const autoJoin = isHubAutoJoin(hub.destination_hash);
        const marker = resolveRrcHubSidebarMarker({
          status: statusForHub(hub.destination_hash),
          autoJoin,
        });
        return (
          <HubRow
            key={hub.destination_hash}
            hub={hub}
            selected={hubDestHash?.toLowerCase() === hub.destination_hash.toLowerCase()}
            sidecarRunning={sidecarRunning}
            unread={unreadForHub(hub.destination_hash)}
            marker={marker}
            autoJoin={autoJoin}
            onConnect={onConnect}
            onToggleFavorite={onToggleFavorite}
            onToggleAutoJoin={onToggleAutoJoin}
          />
        );
      })}
    </ul>
  );
}

export function RrcHubBrowser({
  collapsed,
  onToggleCollapsed,
  sidecarRunning,
  hubSearch,
  onHubSearchChange,
  nickname,
  onNicknameChange,
  favourites,
  discovered,
  hubDestHash,
  unreadForHub,
  statusForHub,
  isHubAutoJoin,
  manualHash,
  onManualHashChange,
  hubTab,
  onHubTabChange,
  onRefresh,
  onConnect,
  onToggleFavorite,
  onToggleAutoJoin,
  onManualConnect,
}: RrcHubBrowserProps) {
  const { t } = useTranslation();
  const rows = hubTab === 'favourites' ? favourites : discovered;

  return (
    <aside
      className={`bg-secondary-dark flex shrink-0 flex-col border-r border-gray-700 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-gray-700 p-2">
        {!collapsed && (
          <span className="text-xs font-semibold tracking-wide text-gray-200 uppercase">
            {t('rrc.hubsTitle')}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-800/60"
            aria-label={t('rrc.refreshHubs')}
            title={t('rrc.refreshHubs')}
            disabled={!sidecarRunning}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-800/60"
            aria-label={collapsed ? t('rrc.expandSidebar') : t('rrc.collapseSidebar')}
            title={collapsed ? t('rrc.expandSidebar') : t('rrc.collapseSidebar')}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {!sidecarRunning && (
            <div className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-2 text-xs text-amber-200">
              {t('connectionPanel.reticulumIdentity.startStackFirst')}
            </div>
          )}
          <p className="text-muted px-1 text-[10px] leading-snug">{t('rrc.hubLegend')}</p>
          <div className="flex gap-1 rounded border border-gray-700 p-0.5 text-[10px]">
            <button
              type="button"
              className={`flex-1 rounded px-1 py-1 ${
                hubTab === 'favourites'
                  ? 'bg-readable-green text-white'
                  : 'border border-gray-600 text-gray-300 hover:bg-gray-800/60'
              }`}
              aria-label={t('rrc.hubs.favourites')}
              onClick={() => {
                onHubTabChange('favourites');
              }}
            >
              {t('rrc.hubs.favourites')}
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-1 py-1 ${
                hubTab === 'discovered'
                  ? 'bg-readable-green text-white'
                  : 'border border-gray-600 text-gray-300 hover:bg-gray-800/60'
              }`}
              aria-label={t('rrc.hubs.discovered')}
              onClick={() => {
                onHubTabChange('discovered');
              }}
            >
              {t('rrc.hubs.discovered')}
            </button>
          </div>
          <input
            type="search"
            value={hubSearch}
            onChange={(e) => {
              onHubSearchChange(e.target.value);
            }}
            placeholder={t('rrc.searchHubs')}
            aria-label={t('rrc.searchHubs')}
            className="bg-deep-black w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-100"
          />
          <label className="block text-xs text-gray-400">
            {t('rrc.nickname')}
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                onNicknameChange(e.target.value);
              }}
              aria-label={t('rrc.nickname')}
              className="bg-deep-black mt-0.5 w-full rounded border border-gray-600 px-2 py-1 text-xs text-gray-100"
            />
          </label>
          {rows.length > 0 ? (
            <HubList
              rows={rows}
              hubDestHash={hubDestHash}
              sidecarRunning={sidecarRunning}
              unreadForHub={unreadForHub}
              statusForHub={statusForHub}
              isHubAutoJoin={isHubAutoJoin}
              onConnect={onConnect}
              onToggleFavorite={onToggleFavorite}
              onToggleAutoJoin={onToggleAutoJoin}
            />
          ) : (
            <p className="text-muted px-2 text-xs">
              {hubTab === 'favourites' ? t('rrc.noFavouriteHubs') : t('rrc.noDiscoveredHubs')}
            </p>
          )}
          <div className="mt-auto space-y-1 border-t border-gray-700 pt-2">
            <input
              type="text"
              value={manualHash}
              onChange={(e) => {
                onManualHashChange(e.target.value);
              }}
              placeholder={t('rrc.manualHashPlaceholder')}
              aria-label={t('rrc.manualHashPlaceholder')}
              className="bg-deep-black w-full rounded border border-gray-600 px-2 py-1 font-mono text-xs text-gray-100"
            />
            <button
              type="button"
              className="bg-readable-green w-full rounded px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              aria-label={t('rrc.connectManual')}
              disabled={!sidecarRunning || !manualHash.trim()}
              onClick={onManualConnect}
            >
              {t('rrc.connectManual')}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
