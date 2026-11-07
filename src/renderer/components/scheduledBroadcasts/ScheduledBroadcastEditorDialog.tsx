import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { countMessageWireBytes } from '@/renderer/lib/chatComposerLimits';
import {
  SCHEDULED_BROADCAST_LABEL_MAX,
  SCHEDULED_BROADCAST_TEXT_MAX,
} from '@/renderer/lib/scheduledBroadcasts/constants';
import { firstDueAt } from '@/renderer/lib/scheduledBroadcasts/recurrence';
import {
  isBroadcastTextEmpty,
  validateBroadcastTextForTargets,
} from '@/renderer/lib/scheduledBroadcasts/textValidation';
import type {
  ScheduledBroadcastInput,
  ScheduledBroadcastInterval,
  ScheduledBroadcastRow,
  ScheduledBroadcastTarget,
} from '@/shared/scheduledBroadcastTypes';

import { ScheduledBroadcastTargetPicker } from './ScheduledBroadcastTargetPicker';

const INTERVALS: ScheduledBroadcastInterval[] = [
  'hourly',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
];

function todayYmd(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Format minutes-since-midnight for `<input type="time">` (`HH:MM`). */
export function minsToHhMm(mins: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.trunc(mins)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parse a time-input value to minutes-since-midnight.
 * Accepts `HH:MM` and `HH:MM:SS` (some browsers emit seconds even with step=60).
 */
export function hhMmToMins(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const hhRaw = parts[0] ?? '';
  const mmRaw = parts[1] ?? '';
  if (hhRaw === '' || mmRaw === '' || mmRaw.length !== 2) return null;
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (parts.length === 3) {
    const ssRaw = parts[2] ?? '';
    if (ssRaw === '') return null;
    const ss = Number(ssRaw);
    if (!Number.isFinite(ss) || ss < 0 || ss >= 60) return null;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export interface ScheduledBroadcastEditorDialogProps {
  slot: number;
  existing: ScheduledBroadcastRow | null;
  onClose: () => void;
  onSave: (input: ScheduledBroadcastInput) => Promise<void>;
}

export function ScheduledBroadcastEditorDialog({
  slot,
  existing,
  onClose,
  onSave,
}: ScheduledBroadcastEditorDialogProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(existing?.label ?? '');
  const [text, setText] = useState(existing?.text ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [interval, setInterval] = useState<ScheduledBroadcastInterval>(
    existing?.interval ?? 'weekly',
  );
  // Keep time/date as strings while editing so controlled inputs do not reformat mid-keystroke
  // (cursor jumps / minutes stuck). Parse to numbers only on save.
  const [timeValue, setTimeValue] = useState(() => minsToHhMm(existing?.timeOfDayMin ?? 540));
  const [weekday, setWeekday] = useState<number>(existing?.weekday ?? 1);
  const [dayOfMonthValue, setDayOfMonthValue] = useState(String(existing?.dayOfMonth ?? 1));
  const [anchorYmd, setAnchorYmd] = useState(existing?.anchorYmd ?? todayYmd());
  const [targets, setTargets] = useState<ScheduledBroadcastTarget[]>(existing?.targets ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledTargets = targets.filter((x) => x.enabled);
  const textFailures = useMemo(
    () => validateBroadcastTextForTargets(text, enabledTargets),
    [text, enabledTargets],
  );
  const emptyText = isBroadcastTextEmpty(text);
  const noTargets = enabledTargets.length === 0;
  const canSave = !emptyText && !noTargets && textFailures.length === 0 && !saving;

  const saveReason = emptyText
    ? t('scheduledBroadcasts.reasons.emptyText')
    : noTargets
      ? t('scheduledBroadcasts.noTargets')
      : textFailures.length > 0
        ? t('scheduledBroadcasts.reasons.textTooLong')
        : null;

  const handleSave = async () => {
    if (!canSave) return;
    const timeOfDayMin = hhMmToMins(timeValue);
    if (timeOfDayMin == null) {
      setError(t('scheduledBroadcasts.invalidTime'));
      return;
    }
    let dayOfMonth: number | null = null;
    if (interval === 'monthly') {
      const day = Number(dayOfMonthValue);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        setError(t('scheduledBroadcasts.invalidDayOfMonth'));
        return;
      }
      dayOfMonth = day;
    }
    if (interval === 'biweekly' && !/^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)) {
      setError(t('scheduledBroadcasts.invalidAnchorDate'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rule = {
        interval,
        timeOfDayMin,
        weekday: interval === 'weekly' || interval === 'biweekly' ? weekday : null,
        dayOfMonth,
        anchorYmd: interval === 'biweekly' ? anchorYmd : null,
      };
      const nextDueAt = enabled ? firstDueAt(rule, Date.now()) : null;
      await onSave({
        slot,
        label: label.slice(0, SCHEDULED_BROADCAST_LABEL_MAX),
        text,
        enabled,
        interval,
        timeOfDayMin,
        weekday: rule.weekday,
        dayOfMonth: rule.dayOfMonth,
        anchorYmd: rule.anchorYmd,
        targets,
        nextDueAt,
      });
      onClose();
    } catch (err) {
      console.warn('[ScheduledBroadcasts] save failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-editor-title"
      className="bg-ink-950/80 fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-ink-900 rounded-modal shadow-level-3 flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto p-4">
        <h2 id="sb-editor-title" className="text-ink-100 text-base font-semibold">
          {t('scheduledBroadcasts.edit')} — {t('scheduledBroadcasts.slotLabel', { n: slot })}
        </h2>
        <label className="text-label text-ink-200 flex flex-col gap-1">
          {t('scheduledBroadcasts.label')}
          <input
            className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
            value={label}
            maxLength={SCHEDULED_BROADCAST_LABEL_MAX}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
            aria-label={t('scheduledBroadcasts.label')}
          />
        </label>
        <label className="text-label text-ink-200 flex flex-col gap-1">
          {t('scheduledBroadcasts.text')}
          <textarea
            className="bg-ink-800 text-ink-100 rounded-control border-ink-600 min-h-24 border px-2 py-1"
            value={text}
            maxLength={SCHEDULED_BROADCAST_TEXT_MAX}
            onChange={(e) => {
              setText(e.target.value);
            }}
            aria-label={t('scheduledBroadcasts.text')}
          />
          <span className="text-ink-400 text-2xs">
            {countMessageWireBytes(text.trim())} B · {t('scheduledBroadcasts.textHint')}
          </span>
        </label>
        <label className="text-label text-ink-100 flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
            }}
            aria-label={t('scheduledBroadcasts.enabled')}
          />
          {t('scheduledBroadcasts.enabled')}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label text-ink-200">{t('scheduledBroadcasts.schedule')}</legend>
          <label className="text-label text-ink-200 flex flex-col gap-1">
            {t('scheduledBroadcasts.intervalLabel')}
            <select
              className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
              value={interval}
              onChange={(e) => {
                setInterval(e.target.value as ScheduledBroadcastInterval);
              }}
              aria-label={t('scheduledBroadcasts.intervalLabel')}
            >
              {INTERVALS.map((iv) => (
                <option key={iv} value={iv}>
                  {t(`scheduledBroadcasts.interval.${iv}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-label text-ink-200 flex flex-col gap-1">
            {t('scheduledBroadcasts.timeOfDay')}
            <input
              type="time"
              step={60}
              className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
              value={timeValue}
              onChange={(e) => {
                // Keep the raw input string — do not round-trip through minutes here.
                setTimeValue(e.target.value);
              }}
              aria-label={t('scheduledBroadcasts.timeOfDay')}
            />
          </label>
          {(interval === 'weekly' || interval === 'biweekly') && (
            <label className="text-label text-ink-200 flex flex-col gap-1">
              {t('scheduledBroadcasts.weekday')}
              <select
                className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
                value={weekday}
                onChange={(e) => {
                  setWeekday(Number(e.target.value));
                }}
                aria-label={t('scheduledBroadcasts.weekday')}
              >
                <option value={0}>{t('scheduledBroadcasts.weekdays.0')}</option>
                <option value={1}>{t('scheduledBroadcasts.weekdays.1')}</option>
                <option value={2}>{t('scheduledBroadcasts.weekdays.2')}</option>
                <option value={3}>{t('scheduledBroadcasts.weekdays.3')}</option>
                <option value={4}>{t('scheduledBroadcasts.weekdays.4')}</option>
                <option value={5}>{t('scheduledBroadcasts.weekdays.5')}</option>
                <option value={6}>{t('scheduledBroadcasts.weekdays.6')}</option>
              </select>
            </label>
          )}
          {interval === 'monthly' && (
            <label className="text-label text-ink-200 flex flex-col gap-1">
              {t('scheduledBroadcasts.dayOfMonth')}
              <input
                type="number"
                min={1}
                max={31}
                inputMode="numeric"
                className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
                value={dayOfMonthValue}
                onChange={(e) => {
                  setDayOfMonthValue(e.target.value);
                }}
                aria-label={t('scheduledBroadcasts.dayOfMonth')}
              />
            </label>
          )}
          {interval === 'biweekly' && (
            <label className="text-label text-ink-200 flex flex-col gap-1">
              {t('scheduledBroadcasts.anchorDate')}
              <input
                type="date"
                className="bg-ink-800 text-ink-100 rounded-control border-ink-600 border px-2 py-1"
                value={anchorYmd}
                onChange={(e) => {
                  setAnchorYmd(e.target.value);
                }}
                aria-label={t('scheduledBroadcasts.anchorDate')}
              />
            </label>
          )}
        </fieldset>
        <div>
          <h3 className="text-label text-ink-200 mb-1">{t('scheduledBroadcasts.targets')}</h3>
          <ScheduledBroadcastTargetPicker targets={targets} onChange={setTargets} />
        </div>
        {saveReason ? <p className="text-label text-orange-400">{saveReason}</p> : null}
        {error ? <p className="text-label text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="bg-ink-700 text-ink-100 rounded-control text-label px-3 py-1.5"
            onClick={onClose}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="bg-brand-green text-app-bg rounded-control text-label px-3 py-1.5 disabled:opacity-50"
            disabled={!canSave}
            onClick={() => void handleSave()}
            aria-label={t('common.save')}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
