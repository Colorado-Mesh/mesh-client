import { ChevronLeft, ChevronRight, RefreshCw, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

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
  recommended: RrcHubInfo[];
  favourites: RrcHubInfo[];
  discovered: RrcHubInfo[];
  manual: RrcHubInfo[];
  hubDestHash: string | null;
  busy: boolean;
  manualHash: string;
  onManualHashChange: (v: string) => void;
  hubTab: 'recommended' | 'discovered';
  onHubTabChange: (tab: 'recommended' | 'discovered') => void;
  onRefresh: () => void;
  onConnect: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
  onManualConnect: () => void;
}

function HubRow({
  hub,
  selected,
  busy,
  sidecarRunning,
  onConnect,
  onToggleFavorite,
}: {
  hub: RrcHubInfo;
  selected: boolean;
  busy: boolean;
  sidecarRunning: boolean;
  onConnect: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
}) {
  const { t } = useTranslation();
  const announceOnly = hub.name_source === 'announce' && !hub.recommended;
  const label = announceOnly
    ? formatHash(hub.destination_hash)
    : (hub.display_name ?? formatHash(hub.destination_hash));
  const secondary = announceOnly
    ? (hub.display_name ?? null)
    : hub.display_name
      ? formatHash(hub.destination_hash)
      : null;

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1.5 text-sm ${
          selected ? 'border-l-2 border-amber-400 bg-amber-950/40' : 'hover:bg-amber-950/25'
        }`}
      >
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={t('rrc.selectHub', { name: label })}
          onClick={() => {
            onConnect(hub.destination_hash);
          }}
          disabled={busy || !sidecarRunning}
        >
          <div className="truncate font-medium text-amber-50">{label}</div>
          <div className="truncate text-xs text-amber-200/50">
            {secondary ?? formatHash(hub.destination_hash)}
            {hub.hops != null ? ` · ${t('rrc.hopsAway', { count: hub.hops })}` : ''}
            {hub.user_count != null ? ` · ${t('rrc.userCount', { count: hub.user_count })}` : ''}
          </div>
          {hub.description ? (
            <div className="truncate text-[10px] text-amber-200/40">{hub.description}</div>
          ) : null}
        </button>
        <button
          type="button"
          className="shrink-0 p-1 text-amber-400"
          aria-label={hub.favorited ? t('rrc.unfavoriteHub') : t('rrc.favoriteHub')}
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

export function RrcHubBrowser({
  collapsed,
  onToggleCollapsed,
  sidecarRunning,
  hubSearch,
  onHubSearchChange,
  nickname,
  onNicknameChange,
  recommended,
  favourites,
  discovered,
  manual,
  hubDestHash,
  busy,
  manualHash,
  onManualHashChange,
  hubTab,
  onHubTabChange,
  onRefresh,
  onConnect,
  onToggleFavorite,
  onManualConnect,
}: RrcHubBrowserProps) {
  const { t } = useTranslation();

  const renderSection = (title: string, rows: RrcHubInfo[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="px-2 py-1 text-[10px] tracking-wide text-amber-500/70 uppercase">
          {title}
        </div>
        <ul className="space-y-0.5">
          {rows.map((hub) => (
            <HubRow
              key={hub.destination_hash}
              hub={hub}
              selected={hubDestHash?.toLowerCase() === hub.destination_hash.toLowerCase()}
              busy={busy}
              sidecarRunning={sidecarRunning}
              onConnect={onConnect}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <aside
      className={`bg-secondary-dark flex shrink-0 flex-col border-r border-amber-800/40 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex items-center justify-between gap-1 border-b border-amber-800/40 p-2">
        {!collapsed && (
          <span className="text-xs font-semibold tracking-wide text-amber-400/80 uppercase">
            {t('rrc.hubsTitle')}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-amber-200/80 hover:bg-amber-950/50"
            aria-label={t('rrc.refreshHubs')}
            disabled={!sidecarRunning}
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 text-amber-200/80 hover:bg-amber-950/50"
            aria-label={collapsed ? t('rrc.expandSidebar') : t('rrc.collapseSidebar')}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {!sidecarRunning && (
            <div className="rounded border border-amber-600/50 bg-amber-900/30 p-2 text-xs text-amber-200">
              {t('connectionPanel.reticulumIdentity.startStackFirst')}
            </div>
          )}
          <div className="flex gap-1 rounded border border-amber-800/40 p-0.5 text-[10px]">
            <button
              type="button"
              className={`flex-1 rounded px-1 py-1 ${
                hubTab === 'recommended'
                  ? 'bg-amber-800/60 text-amber-50'
                  : 'text-amber-200/60 hover:bg-amber-950/40'
              }`}
              aria-label={t('rrc.hubs.recommended')}
              onClick={() => {
                onHubTabChange('recommended');
              }}
            >
              {t('rrc.hubs.recommended')}
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-1 py-1 ${
                hubTab === 'discovered'
                  ? 'bg-amber-800/60 text-amber-50'
                  : 'text-amber-200/60 hover:bg-amber-950/40'
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
            className="w-full rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 text-xs text-amber-50"
          />
          <label className="block text-xs text-amber-200/60">
            {t('rrc.nickname')}
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                onNicknameChange(e.target.value);
              }}
              aria-label={t('rrc.nickname')}
              className="mt-0.5 w-full rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 text-xs text-amber-50"
            />
          </label>
          {hubTab === 'recommended' && (
            <>
              {renderSection(t('rrc.hubs.recommended'), recommended)}
              {renderSection(t('rrc.hubs.favourites'), favourites)}
              {renderSection(t('rrc.hubs.manual'), manual)}
            </>
          )}
          {hubTab === 'discovered' && (
            <>
              {renderSection(t('rrc.hubs.discovered'), discovered)}
              {discovered.length === 0 && (
                <p className="px-2 text-xs text-amber-200/40">{t('rrc.noDiscoveredHubs')}</p>
              )}
            </>
          )}
          <div className="mt-auto space-y-1 border-t border-amber-800/40 pt-2">
            <input
              type="text"
              value={manualHash}
              onChange={(e) => {
                onManualHashChange(e.target.value);
              }}
              placeholder={t('rrc.manualHashPlaceholder')}
              aria-label={t('rrc.manualHashPlaceholder')}
              className="w-full rounded border border-amber-800/50 bg-slate-900/80 px-2 py-1 font-mono text-xs text-amber-50"
            />
            <button
              type="button"
              className="w-full rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              aria-label={t('rrc.connectManual')}
              disabled={busy || !sidecarRunning || !manualHash.trim()}
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
