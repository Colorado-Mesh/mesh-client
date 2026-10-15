import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';

import { HelpTooltip } from './HelpTooltip';
import { buttonClassName } from './ui/Button';
import { INPUT_BOX_CLASS, SELECT_BOX_CLASS } from './ui/formClasses';

export function cfgBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function cfgNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function cfgStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

// ─── Reusable config components (same pattern as RadioPanel) ─────

export function ConfigSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  description,
  anchorId,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (val: number) => void;
  disabled: boolean;
  description?: string;
  anchorId?: string;
}) {
  return (
    <div data-setting-anchor={anchorId} className="space-y-1">
      <label className="text-muted text-sm">{label}</label>
      <select
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        disabled={disabled}
        aria-label={label}
        className={`${SELECT_BOX_CLASS} w-full`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

export function ConfigToggle({
  label,
  checked,
  onChange,
  disabled,
  description,
  anchorId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  description?: string;
  anchorId?: string;
}) {
  return (
    <div data-setting-anchor={anchorId} className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-ink-300 text-sm">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => {
            onChange(!checked);
          }}
          disabled={disabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            checked ? 'bg-brand-green' : 'bg-ink-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-4.5' : 'translate-x-0.75'
            }`}
          />
        </button>
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

export function ConfigNumber({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  unit,
  description,
  tooltip,
  anchorId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
  tooltip?: string;
  anchorId?: string;
}) {
  return (
    <div data-setting-anchor={anchorId} className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="text-muted text-sm">{label}</label>
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(n);
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          className={`${INPUT_BOX_CLASS} w-28`}
        />
        {unit && <span className="text-muted text-sm">{unit}</span>}
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

export function ConfigText({
  label,
  value,
  onChange,
  disabled,
  description,
  password,
  anchorId,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  description?: string;
  password?: boolean;
  anchorId?: string;
  maxLength?: number;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div data-setting-anchor={anchorId} className="space-y-1">
      <label className="text-muted text-sm">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type={password && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          disabled={disabled}
          maxLength={maxLength}
          aria-label={label}
          className={`${INPUT_BOX_CLASS} flex-1`}
        />
        {password && (
          <button
            type="button"
            onClick={() => {
              setShow((s) => !s);
            }}
            className="text-muted hover:text-ink-300 px-2 py-2 text-xs"
          >
            {show ? t('common.hide') : t('common.show')}
          </button>
        )}
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

export function ModuleSection({
  title,
  children,
  onApply,
  applying,
  disabled,
  sliceReady = true,
  showSliceWaiting = false,
  globalApplyLocked = false,
  anchorId,
}: {
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  applying: boolean;
  disabled: boolean;
  /** When false, Apply stays disabled until device module slice is hydrated. */
  sliceReady?: boolean;
  /** Show "waiting for settings" hint (pass when connected and slice not ready). */
  showSliceWaiting?: boolean;
  /** When true, Apply is disabled while any module section is applying. */
  globalApplyLocked?: boolean;
  anchorId?: string;
}) {
  const { t } = useTranslation();
  const applyDisabled = disabled || applying || !sliceReady || globalApplyLocked;
  return (
    <details
      data-setting-anchor={anchorId}
      className="group bg-deep-black/50 border-ink-700 rounded-lg border"
    >
      <summary className="text-ink-200 hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium transition-colors">
        <span>{title}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {showSliceWaiting && !sliceReady && (
          <p className="text-xs text-orange-300/90">
            {t('radioPanel.waitingForConfigSection', { section: title })}
          </p>
        )}
        {children}
        <button
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          className={buttonClassName('primary', 'md')}
        >
          {applying
            ? t('modulePanel.applyingButton')
            : t('modulePanel.applySection', { section: title })}
        </button>
      </div>
    </details>
  );
}

export function StatusOnlySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group bg-deep-black/50 border-ink-700 rounded-lg border">
      <summary className="text-ink-200 hover:bg-ink-800 flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium transition-colors">
        <span>{title}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export function formatTimeAgo(ts: number, t: TFunction): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
}

export function ModuleStatus({
  packets,
  label,
}: {
  packets?: Map<number, { from: number; data: Uint8Array; timestamp: number }[]>;
  label: string;
}) {
  const { t } = useTranslation();
  if (!packets || packets.size === 0) {
    return (
      <div className="bg-ink-800/50 rounded px-3 py-2 text-xs">
        <span className="text-muted">{t('modulePanel.statusNoPackets', { label })}</span>
      </div>
    );
  }
  const total = Array.from(packets.values()).reduce((sum, arr) => sum + arr.length, 0);
  const latest = Math.max(
    ...Array.from(packets.values()).flatMap((arr) => arr.map((p) => p.timestamp)),
  );
  const lastSeen = formatTimeAgo(latest, t);
  return (
    <div className="bg-ink-800/50 rounded px-3 py-2 text-xs">
      <span className="text-ink-400">
        {t('modulePanel.statusLine', {
          count: packets.size,
          label,
          total,
          lastSeen,
        })}
      </span>
    </div>
  );
}
