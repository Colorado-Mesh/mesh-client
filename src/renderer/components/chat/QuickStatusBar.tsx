import { useTranslation } from 'react-i18next';

import {
  DEFAULT_QUICK_STATUS_PRESETS,
  formatQuickStatusPayload,
  type QuickStatusPreset,
} from '@/renderer/lib/quickStatusMessages';
import { ROLL_CALL_COMMAND_TEXT } from '@/renderer/lib/rollCall';

export interface RollCallSummary {
  responded: number;
  expected: number;
}

export interface QuickStatusBarProps {
  onSend: (text: string) => void | Promise<void>;
  onRollCall?: () => void | Promise<void>;
  disabled?: boolean;
  presets?: readonly QuickStatusPreset[];
  /** Live roll-call tally (best-effort heard replies). */
  rollCallSummary?: RollCallSummary | null;
}

export function QuickStatusBar({
  onSend,
  onRollCall,
  disabled = false,
  presets = DEFAULT_QUICK_STATUS_PRESETS,
  rollCallSummary = null,
}: QuickStatusBarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1"
      role="group"
      aria-label={t('quickStatus.barAria')}
    >
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          disabled={disabled}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[11px] text-gray-100 hover:bg-slate-700 disabled:opacity-50"
          aria-label={t(preset.labelKey)}
          onClick={() => {
            void onSend(formatQuickStatusPayload(preset));
          }}
        >
          {t(preset.labelKey)}
        </button>
      ))}
      {onRollCall ? (
        <button
          type="button"
          disabled={disabled}
          className="rounded border border-cyan-700/60 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-100 hover:bg-cyan-900/50 disabled:opacity-50"
          aria-label={t('quickStatus.rollCallAria')}
          onClick={() => {
            void onRollCall();
          }}
          title={ROLL_CALL_COMMAND_TEXT}
        >
          {t('quickStatus.rollCall')}
        </button>
      ) : null}
      {rollCallSummary != null ? (
        <span className="text-[11px] text-gray-300" role="status">
          {t('quickStatus.rollCallTally', {
            responded: rollCallSummary.responded,
            expected: rollCallSummary.expected,
          })}
        </span>
      ) : null}
    </div>
  );
}
