import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { useBeaconTraffic } from '@/renderer/hooks/useBeaconTraffic';
import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { findRegionalFeedPreset, getRegionalFeedPresets } from '@/renderer/lib/map/beaconPresets';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { beaconStatusMessageKey, type RegionalFeedProvider } from '@/shared/beacon';

import { Button } from '../ui/Button';
import { INPUT_BOX_SM_CLASS, SELECT_BOX_SM_CLASS } from '../ui/formClasses';

function savedFeedUrl(provider: RegionalFeedProvider): string {
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'regional feed URL',
  );
  const saved = settings?.[provider === 'corescope' ? 'mapCoreScopeUrl' : 'mapBeaconUrl'];
  return typeof saved === 'string' ? saved : (getRegionalFeedPresets(provider)[0]?.baseUrl ?? '');
}

interface ConnectionControlsProps {
  feed: ReturnType<typeof useBeaconTraffic>;
  provider?: RegionalFeedProvider;
}

export function BeaconConnectionControls({ feed, provider = 'beacon' }: ConnectionControlsProps) {
  // A provider change resets drafts, selected server region, and saved-URL lookup together.
  return <RegionalConnectionForm key={provider} feed={feed} provider={provider} />;
}

function RegionalConnectionForm({ feed, provider = 'beacon' }: ConnectionControlsProps) {
  const { t } = useTranslation();
  const presets = getRegionalFeedPresets(provider);
  const [url, setUrl] = useState(() => savedFeedUrl(provider));
  const [presetId, setPresetId] = useState(
    () => findRegionalFeedPreset(url, provider)?.id ?? 'custom',
  );
  const [customUrl, setCustomUrl] = useState(() =>
    findRegionalFeedPreset(url, provider) ? '' : url,
  );
  const [directoryUrl, setDirectoryUrl] = useState(url);
  const [region, setRegion] = useState('');
  const [stopping, setStopping] = useState(false);
  const [actionError, setActionError] = useState(false);
  const attempt = useRef(0);
  const busy = feed.status === 'connecting' || feed.status === 'reconnecting';
  const connected = feed.status === 'live';
  const statusText =
    provider === 'corescope' && feed.status === 'disconnected'
      ? t('liveTraffic.corescope.disconnected')
      : t(`liveTraffic.beacon.status.${feed.status}`);
  return (
    <div className="border-ink-700/50 bg-deep-black text-label border-b px-3 py-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const request = ++attempt.current;
          setActionError(false);
          const requestedUrl = url.trim();
          void feed
            .connect(requestedUrl, region || undefined)
            .then((ok) => {
              if (!ok || request !== attempt.current) return;
              mergeAppSetting(
                provider === 'corescope' ? 'mapCoreScopeUrl' : 'mapBeaconUrl',
                requestedUrl,
                'regional feed URL',
              );
              setDirectoryUrl(requestedUrl);
            })
            .catch((cause: unknown) => {
              if (request === attempt.current) setActionError(true);
              console.warn('[regional-feed] connect failed', cause);
            });
        }}
      >
        <select
          aria-label={t(
            provider === 'corescope' ? 'liveTraffic.corescope.preset' : 'liveTraffic.beacon.preset',
          )}
          value={presetId}
          disabled={busy || stopping}
          className={`${SELECT_BOX_SM_CLASS} max-w-48`}
          onChange={(event) => {
            const selectedId = event.target.value;
            const preset = presets.find((item) => item.id === selectedId);
            setPresetId(selectedId);
            setUrl(preset?.baseUrl ?? customUrl);
            setRegion('');
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          <option value="custom">{t('liveTraffic.beacon.custom')}</option>
        </select>
        <input
          className={`${INPUT_BOX_SM_CLASS} min-w-48 flex-1`}
          type="url"
          required
          disabled={busy || stopping}
          aria-label={t(
            provider === 'corescope' ? 'liveTraffic.corescope.url' : 'liveTraffic.beacon.url',
          )}
          value={url}
          onChange={(event) => {
            const nextUrl = event.target.value;
            setUrl(nextUrl);
            setPresetId(findRegionalFeedPreset(nextUrl, provider)?.id ?? 'custom');
            setCustomUrl(nextUrl);
            setRegion('');
          }}
          placeholder={
            provider === 'corescope'
              ? 'https://corescope.example.org'
              : 'https://beacon.example.org'
          }
        />
        {feed.regions.length > 0 && url.trim() === directoryUrl.trim() && (
          <select
            aria-label={t('liveTraffic.beacon.region')}
            value={region}
            disabled={busy || stopping}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
            className={SELECT_BOX_SM_CLASS}
          >
            <option value="">{t('liveTraffic.regions.all')}</option>
            {feed.regions.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={busy || stopping}
          aria-label={t('liveTraffic.beacon.connect')}
        >
          {t('liveTraffic.beacon.connect')}
        </Button>
        <span className="text-muted text-xs">{t('liveTraffic.beacon.readOnly')}</span>
      </form>
      {(connected || busy) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1"
          disabled={stopping}
          aria-label={t(busy ? 'liveTraffic.cancelConnection' : 'liveTraffic.beacon.disconnect')}
          onClick={() => {
            const request = ++attempt.current;
            setStopping(true);
            setActionError(false);
            void feed
              .disconnect()
              .catch((cause: unknown) => {
                if (request === attempt.current) setActionError(true);
                console.warn('[regional-feed] disconnect failed', cause);
              })
              .finally(() => {
                if (request === attempt.current) setStopping(false);
              });
          }}
        >
          {t(busy ? 'liveTraffic.cancelConnection' : 'liveTraffic.beacon.disconnect')}
        </Button>
      )}
      <p
        className={`mt-1 text-xs ${feed.error || actionError ? 'text-orange-300' : 'text-muted'}`}
        role="status"
      >
        {actionError
          ? t('liveTraffic.connectionActionFailed')
          : feed.error
            ? t(beaconStatusMessageKey(feed.error) ?? 'liveTraffic.beacon.status.error')
            : statusText}
      </p>
      {feed.directoryLimited && (
        <p className="text-status-warning mt-1 text-xs" role="status">
          {t('liveTraffic.directoryLimited')}
        </p>
      )}
    </div>
  );
}
