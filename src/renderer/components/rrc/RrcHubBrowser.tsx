import { Search, Star } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { RrcByteLimitHint } from '@/renderer/components/rrc/RrcByteLimitHint';
import { resolveRrcHubSidebarMarker, type RrcHubSidebarMarker } from '@/renderer/lib/rrcHubPrefs';
import type { RrcHubInfo } from '@/shared/rrc-types';

import { Button } from '../ui/Button';
import { chipClass, FIELD_LABEL_CLASS, INPUT_CLASS, NOTICE_CLASS } from '../ui/formClasses';
import { SegmentedControl } from '../ui/SegmentedControl';
import { StatusDot, type StatusDotTone } from '../ui/StatusDot';

const MARKER_DOT: Record<RrcHubSidebarMarker['kind'], { tone: StatusDotTone; pulse: boolean }> = {
  connected: { tone: 'ok', pulse: false },
  connecting: { tone: 'warn', pulse: true },
  autoJoinNotConnected: { tone: 'idle', pulse: false },
  idle: { tone: 'off', pulse: false },
};

function formatHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Hub list body for the RRC list column (the column header and its Refresh live in RrcPanel). */
export interface RrcHubBrowserProps {
  sidecarRunning: boolean;
  hubSearch: string;
  onHubSearchChange: (v: string) => void;
  nickname: string;
  onNicknameChange: (v: string) => void;
  /** Hub WELCOME max_nick_bytes when known. */
  maxNickBytes?: number | null;
  connected: RrcHubInfo[];
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
  hubTab: 'connected' | 'favourites' | 'discovered';
  onHubTabChange: (tab: 'connected' | 'favourites' | 'discovered') => void;
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
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${
          selected ? 'bg-sidebar-active-bg' : 'hover:bg-sidebar-active-bg/60'
        }`}
      >
        <span className="inline-flex shrink-0" title={markerTitle} aria-hidden>
          <StatusDot tone={MARKER_DOT[marker.kind].tone} pulse={MARKER_DOT[marker.kind].pulse} />
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
            <div
              className={`truncate font-medium ${selected ? 'text-bright-green' : 'text-zinc-100'}`}
            >
              {label}
            </div>
            {unread > 0 && (
              <span className="text-2xs shrink-0 rounded-full bg-red-600 px-1.5 font-bold text-white">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
          <div className="text-muted text-meta truncate font-mono">
            {secondary ?? formatHash(hub.destination_hash)}
            {hub.hops != null ? ` · ${t('rrc.hopsAway', { count: hub.hops })}` : ''}
            {hub.user_count != null ? ` · ${t('rrc.userCount', { count: hub.user_count })}` : ''}
          </div>
          {hub.description ? (
            <div className="text-muted truncate text-xs">{hub.description}</div>
          ) : null}
        </button>
        <button
          type="button"
          className={`${chipClass(autoJoin, 'sm')} shrink-0`}
          aria-label={autoJoin ? t('rrc.disableHubAutoJoin') : t('rrc.enableHubAutoJoin')}
          aria-pressed={autoJoin}
          title={autoJoin ? t('rrc.hubAutoJoinOnHint') : t('rrc.hubAutoJoinOffHint')}
          onClick={() => {
            onToggleAutoJoin(hub.destination_hash);
          }}
        >
          {t('rrc.autoJoinChip')}
        </button>
        <button
          type="button"
          className={`shrink-0 rounded p-1 ${hub.favorited ? 'text-bright-green' : 'text-muted hover:text-zinc-200'}`}
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
  sidecarRunning,
  hubSearch,
  onHubSearchChange,
  nickname,
  onNicknameChange,
  maxNickBytes = null,
  connected,
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
  onConnect,
  onToggleFavorite,
  onToggleAutoJoin,
  onManualConnect,
}: RrcHubBrowserProps) {
  const { t } = useTranslation();
  const rows =
    hubTab === 'connected' ? connected : hubTab === 'favourites' ? favourites : discovered;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {!sidecarRunning && (
        <div className={NOTICE_CLASS.warn}>
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </div>
      )}
      <SegmentedControl
        aria-label={t('rrc.hubsTitle')}
        value={hubTab}
        onChange={onHubTabChange}
        options={[
          { value: 'connected', label: t('rrc.hubs.connected') },
          { value: 'favourites', label: t('rrc.hubs.favourites') },
          { value: 'discovered', label: t('rrc.hubs.discovered') },
        ]}
      />
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
          size={16}
        />
        <input
          type="search"
          value={hubSearch}
          onChange={(e) => {
            onHubSearchChange(e.target.value);
          }}
          placeholder={t('rrc.searchHubs')}
          aria-label={t('rrc.searchHubs')}
          className={`${INPUT_CLASS} pl-8`}
        />
      </div>
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
        <p className="text-muted px-1 text-xs">
          {hubTab === 'connected'
            ? t('rrc.noConnectedHubs')
            : hubTab === 'favourites'
              ? t('rrc.noFavouriteHubs')
              : t('rrc.noDiscoveredHubs')}
        </p>
      )}
      <p className="text-muted px-1 text-xs leading-snug">{t('rrc.hubLegend')}</p>
      <div className="mt-auto space-y-3 border-t border-zinc-800 pt-3">
        <label className={`block ${FIELD_LABEL_CLASS}`}>
          {t('rrc.nickname')}
          <input
            type="text"
            value={nickname}
            onChange={(e) => {
              onNicknameChange(e.target.value);
            }}
            aria-label={t('rrc.nickname')}
            className={`${INPUT_CLASS} mt-1`}
          />
          <RrcByteLimitHint
            text={nickname}
            limit={maxNickBytes}
            overMaxKey="rrc.nickLimit.overMax"
          />
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualHash}
            onChange={(e) => {
              onManualHashChange(e.target.value);
            }}
            placeholder={t('rrc.manualHashPlaceholder')}
            aria-label={t('rrc.manualHashPlaceholder')}
            className={`${INPUT_CLASS} font-mono`}
          />
          <Button
            variant="primary"
            size="sm"
            aria-label={t('rrc.connectManual')}
            disabled={!sidecarRunning || !manualHash.trim()}
            onClick={onManualConnect}
          >
            {t('rrc.connectManual')}
          </Button>
        </div>
      </div>
    </div>
  );
}
