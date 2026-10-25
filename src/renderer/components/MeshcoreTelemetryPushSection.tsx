import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import {
  type MeshcoreTelemetryPushActions,
  MeshcoreTelemetryPushError,
} from '../hooks/meshcore/useMeshcoreTelemetryPush';
import {
  clampMeshcoreTelemetryPushTimeoutSecs,
  MESHCORE_TELEMETRY_PUSH_MAX_TIMEOUT_SECS,
  MESHCORE_TELEMETRY_PUSH_METRICS,
  MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS,
  type MeshcoreTelemetryPushMetric,
  type MeshcoreTelemetryPushThresholds,
} from '../lib/meshcore/meshcoreTelemetryPush';
import { SettingsCollapsible } from './ui/SettingsSection';
import { Switch } from './ui/Switch';

export interface MeshcoreTelemetryPushSectionProps {
  nodeId: number;
  push: MeshcoreTelemetryPushActions;
  /** Prompt for / confirm sensor login before subscribing; false cancels. */
  ensureAccess: () => Promise<boolean>;
  /** Radio not connected: everything is read-only. */
  disabled: boolean;
}

const DEFAULT_THRESHOLDS: Record<MeshcoreTelemetryPushMetric, string> = {
  temperature: '0.5',
  humidity: '2',
  voltage: '0.1',
  pressure: '1',
};

const DEFAULT_LEASE_MINUTES = '60';
const MIN_LEASE_MINUTES = MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS / 60;
const MAX_LEASE_MINUTES = Math.floor(MESHCORE_TELEMETRY_PUSH_MAX_TIMEOUT_SECS / 60);

function parseThresholds(
  values: Record<MeshcoreTelemetryPushMetric, string>,
): MeshcoreTelemetryPushThresholds {
  const out: MeshcoreTelemetryPushThresholds = {};
  for (const metric of MESHCORE_TELEMETRY_PUSH_METRICS) {
    const n = Number.parseFloat(values[metric]);
    if (Number.isFinite(n) && n > 0) out[metric] = n;
  }
  return out;
}

/** Sensor telemetry push (v1.18 REQ_TYPE 0x08): the sensor sends readings when they change. */
export default function MeshcoreTelemetryPushSection({
  nodeId,
  push,
  ensureAccess,
  disabled,
}: MeshcoreTelemetryPushSectionProps) {
  const { t } = useTranslation();
  const subscription = push.subscriptions.get(nodeId) ?? null;
  const metricLabels: Record<MeshcoreTelemetryPushMetric, string> = {
    temperature: t('meshcoreTelemetryPush.metric.temperature'),
    humidity: t('meshcoreTelemetryPush.metric.humidity'),
    voltage: t('meshcoreTelemetryPush.metric.voltage'),
    pressure: t('meshcoreTelemetryPush.metric.pressure'),
  };
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [leaseMinutes, setLeaseMinutes] = useState(DEFAULT_LEASE_MINUTES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!(await ensureAccess())) return;
      const minutes = Number.parseFloat(leaseMinutes);
      await push.subscribe(nodeId, {
        timeoutSecs: clampMeshcoreTelemetryPushTimeoutSecs(minutes * 60),
        thresholds: parseThresholds(thresholds),
      });
    } catch (e) {
      console.warn('[MeshcoreTelemetryPushSection] subscribe failed ' + errLikeToLogString(e));
      if (e instanceof MeshcoreTelemetryPushError) {
        setError(
          e.code === 'noMetrics'
            ? t('meshcoreTelemetryPush.errorNoMetrics')
            : t('meshcoreTelemetryPush.errorRejected'),
        );
      } else {
        setError(t('meshcoreTelemetryPush.errorFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setError(null);
    setBusy(true);
    try {
      await push.unsubscribe(nodeId);
    } finally {
      setBusy(false);
    }
  };

  const inputsDisabled = disabled || busy || subscription != null;

  return (
    <SettingsCollapsible title={t('meshcoreTelemetryPush.summary')} titleAs="span">
      <Switch
        checked={subscription != null}
        onChange={(on) => {
          void (on ? start() : stop());
        }}
        label={t('meshcoreTelemetryPush.enableLabel')}
        description={t('meshcoreTelemetryPush.enableDescription')}
        disabled={disabled || busy}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {subscription && (
        <p className="text-muted text-sm" role="status">
          {subscription.lastPushAt != null
            ? t('meshcoreTelemetryPush.lastPush', {
                time: new Date(subscription.lastPushAt).toLocaleTimeString(),
              })
            : t('meshcoreTelemetryPush.waitingForPush')}
        </p>
      )}
      <fieldset className="space-y-2" disabled={inputsDisabled}>
        <legend className="text-ink-300 text-xs font-semibold">
          {t('meshcoreTelemetryPush.thresholdsLegend')}
        </legend>
        <p className="text-muted text-xs">{t('meshcoreTelemetryPush.thresholdsHint')}</p>
        <div className="grid grid-cols-2 gap-2">
          {MESHCORE_TELEMETRY_PUSH_METRICS.map((metric) => (
            <label key={metric} className="text-ink-300 flex flex-col gap-1 text-xs">
              {metricLabels[metric]}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={metricLabels[metric]}
                value={thresholds[metric]}
                onChange={(e) => {
                  const value = e.target.value;
                  setThresholds((prev) => ({ ...prev, [metric]: value }));
                }}
                className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control border px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
          ))}
        </div>
        <label className="text-ink-300 flex flex-col gap-1 text-xs">
          {t('meshcoreTelemetryPush.leaseLabel')}
          <input
            type="number"
            inputMode="numeric"
            min={MIN_LEASE_MINUTES}
            max={MAX_LEASE_MINUTES}
            step={1}
            aria-label={t('meshcoreTelemetryPush.leaseLabel')}
            value={leaseMinutes}
            onChange={(e) => {
              setLeaseMinutes(e.target.value);
            }}
            className="bg-secondary-dark border-ink-600 text-ink-200 rounded-control border px-2 py-1 text-sm disabled:opacity-50"
          />
        </label>
        <p className="text-muted text-xs">{t('meshcoreTelemetryPush.leaseHint')}</p>
      </fieldset>
    </SettingsCollapsible>
  );
}
