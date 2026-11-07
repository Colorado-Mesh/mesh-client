import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from '@/renderer/lib/defaultAppSettings';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { SCHEDULED_BROADCASTS_ENABLED_SETTING } from '@/renderer/lib/scheduledBroadcasts/constants';
import { getScheduledBroadcastScheduler } from '@/renderer/lib/scheduledBroadcasts/scheduler';
import { useScheduledBroadcastsStore } from '@/renderer/stores/scheduledBroadcastsStore';
import type { ScheduledBroadcastInput } from '@/shared/scheduledBroadcastTypes';
import { SCHEDULED_BROADCAST_SLOT_COUNT } from '@/shared/scheduledBroadcastTypes';

import { Switch } from '../ui/Switch';
import { ScheduledBroadcastEditorDialog } from './ScheduledBroadcastEditorDialog';
import { ScheduledBroadcastStatusBadge } from './ScheduledBroadcastStatusBadge';

function readMasterEnabled(): boolean {
  const parsed = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'ScheduledBroadcastsPanel',
  );
  const v = parsed?.[SCHEDULED_BROADCASTS_ENABLED_SETTING];
  if (typeof v === 'boolean') return v;
  return DEFAULT_APP_SETTINGS_SHARED.scheduledBroadcastsEnabled;
}

function formatNextDue(ms: number | null | undefined, neverLabel: string): string {
  if (ms == null) return neverLabel;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    // catch-no-log-ok Invalid Date / locale formatting edge cases
    return neverLabel;
  }
}

export default function ScheduledBroadcastsPanel() {
  const { t } = useTranslation();
  const slots = useScheduledBroadcastsStore((s) => s.slots);
  const save = useScheduledBroadcastsStore((s) => s.save);
  const remove = useScheduledBroadcastsStore((s) => s.remove);
  const [masterEnabled, setMasterEnabled] = useState(readMasterEnabled);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [busySlot, setBusySlot] = useState<number | null>(null);

  const setMaster = useCallback((checked: boolean) => {
    setMasterEnabled(checked);
    mergeAppSetting(SCHEDULED_BROADCASTS_ENABLED_SETTING, checked, 'ScheduledBroadcastsPanel');
    void window.electronAPI.appSettings
      .set(SCHEDULED_BROADCASTS_ENABLED_SETTING, checked ? 'true' : 'false')
      .catch((err: unknown) => {
        console.warn(
          '[ScheduledBroadcasts] persist master switch failed ' + errLikeToLogString(err),
        );
      });
  }, []);

  const slotNumbers = useMemo(
    () => Array.from({ length: SCHEDULED_BROADCAST_SLOT_COUNT }, (_, i) => i + 1),
    [],
  );

  const handleSave = async (input: ScheduledBroadcastInput) => {
    await save(input);
  };

  const handleSendNow = async (slot: number) => {
    setBusySlot(slot);
    try {
      const result = await getScheduledBroadcastScheduler().sendNow(slot);
      if (result.status === 'busy') {
        console.warn(`[ScheduledBroadcasts] sendNow busy slot=${String(slot)}`);
      }
    } catch (err: unknown) {
      console.warn(
        `[ScheduledBroadcasts] sendNow failed slot=${String(slot)} ` + errLikeToLogString(err),
      );
    } finally {
      setBusySlot(null);
    }
  };

  const handleDelete = async (slot: number) => {
    if (!window.confirm(t('scheduledBroadcasts.deleteConfirm'))) return;
    try {
      await remove(slot);
    } catch (err: unknown) {
      console.warn(
        `[ScheduledBroadcasts] delete failed slot=${String(slot)} ` + errLikeToLogString(err),
      );
    }
  };

  return (
    <section
      aria-labelledby="scheduled-broadcasts-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-col gap-2">
        <h2 id="scheduled-broadcasts-title" className="text-ink-100 text-base font-semibold">
          {t('scheduledBroadcasts.title')}
        </h2>
        <p className="text-ink-300 text-label max-w-prose">{t('scheduledBroadcasts.intro')}</p>
        <p
          role="note"
          className="text-label rounded-card max-w-prose border border-orange-800/60 bg-orange-950/40 px-3 py-2 text-orange-200"
        >
          {t('scheduledBroadcasts.respectWarning')}
        </p>
        <div data-setting-anchor="scheduledBroadcasts.enabled">
          <Switch
            checked={masterEnabled}
            onChange={setMaster}
            label={t('scheduledBroadcasts.enabled')}
            description={t('scheduledBroadcasts.enabledHint')}
          />
        </div>
        {!masterEnabled ? (
          <p className="text-ink-400 text-label">{t('scheduledBroadcasts.disabledBySetting')}</p>
        ) : null}
        {Object.values(slots).some(
          (row) =>
            row != null &&
            row.enabled &&
            row.interval === 'hourly' &&
            row.targets.filter((x) => x.enabled).length > 2,
        ) ? (
          <p className="text-label text-orange-400">{t('scheduledBroadcasts.airtimeWarning')}</p>
        ) : null}
      </div>

      <ul aria-label={t('scheduledBroadcasts.title')} className="flex flex-col gap-2">
        {slotNumbers.map((n) => {
          const row = slots[n];
          const empty = row == null || (!row.text.trim() && row.targets.length === 0);
          return (
            <li
              key={n}
              className="bg-ink-800 rounded-card flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-ink-700 text-ink-100 rounded-badge text-2xs px-1.5 py-0.5">
                    B{n}
                  </span>
                  <span className="text-ink-100 text-label font-medium">
                    {empty
                      ? t('scheduledBroadcasts.add')
                      : row.label || t('scheduledBroadcasts.slotLabel', { n })}
                  </span>
                  {row ? <ScheduledBroadcastStatusBadge result={row.lastResult} /> : null}
                </div>
                {!empty && row ? (
                  <>
                    <p className="text-ink-300 text-label mt-1 line-clamp-2 whitespace-pre-wrap">
                      {row.text}
                    </p>
                    <p className="text-ink-400 text-label mt-1">
                      {t(`scheduledBroadcasts.interval.${row.interval}`)}
                      {' · '}
                      {t('scheduledBroadcasts.nextDue')}:{' '}
                      {formatNextDue(row.nextDueAt, t('scheduledBroadcasts.never'))}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.targets
                        .filter((x) => x.enabled)
                        .map((tg) => (
                          <span
                            key={`${tg.kind}-${tg.identityId}-${tg.channelIndex ?? tg.room ?? tg.roomPubKeyHex}`}
                            className="bg-ink-700 text-ink-200 rounded-badge text-2xs px-1.5 py-0.5"
                          >
                            {tg.label}
                          </span>
                        ))}
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="bg-ink-700 text-ink-100 rounded-control text-label px-2 py-1"
                  onClick={() => {
                    setEditingSlot(n);
                  }}
                  aria-label={empty ? t('scheduledBroadcasts.add') : t('scheduledBroadcasts.edit')}
                >
                  {empty ? t('scheduledBroadcasts.add') : t('scheduledBroadcasts.edit')}
                </button>
                {!empty ? (
                  <>
                    <button
                      type="button"
                      className="bg-brand-green text-app-bg rounded-control text-label px-2 py-1 disabled:opacity-50"
                      disabled={busySlot === n || !masterEnabled}
                      onClick={() => void handleSendNow(n)}
                      aria-label={t('scheduledBroadcasts.sendNow')}
                    >
                      {t('scheduledBroadcasts.sendNow')}
                    </button>
                    <button
                      type="button"
                      className="rounded-control text-label bg-red-900 px-2 py-1 text-white"
                      onClick={() => void handleDelete(n)}
                      aria-label={t('scheduledBroadcasts.delete')}
                    >
                      {t('scheduledBroadcasts.delete')}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {editingSlot != null ? (
        <ScheduledBroadcastEditorDialog
          slot={editingSlot}
          existing={slots[editingSlot] ?? null}
          onClose={() => {
            setEditingSlot(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </section>
  );
}
