import { Minus, Plus } from 'lucide-react-motion';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';

export interface StepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Muted line under the control. */
  hint?: string;
  id?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Number nudger: minus, value, plus (style guide: retry counts and other small integers). Typing
 * commits on blur or Enter; out-of-range and non-numeric input snaps back into range.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  disabled,
  hint,
  id,
}: StepperProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  /** Typed text while editing; `null` shows `value`. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (next: number) => {
    const clamped = clamp(Number.isFinite(next) ? Math.round(next) : value, min, max);
    setDraft(null);
    if (clamped !== value) onChange(clamped);
  };

  const buttonClass =
    'flex h-7.5 w-8 items-center justify-center bg-sidebar-active-bg text-ink-300 transition-colors hover:bg-secondary-dark hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-muted text-xs">
        {label}
      </label>
      <div className="border-secondary-dark bg-app-bg rounded-control inline-flex w-fit items-center overflow-hidden border">
        <button
          type="button"
          aria-label={t('ui.stepper.decrease', { label })}
          disabled={disabled || value <= min}
          onClick={() => {
            commit(value - step);
          }}
          className={buttonClass}
        >
          <Minus aria-hidden className={ICON_MD} size={16} />
        </button>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          value={draft ?? String(value)}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={() => {
            if (draft !== null) commit(Number(draft));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft !== null) commit(Number(draft));
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              commit(value + step);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              commit(value - step);
            }
          }}
          className="border-secondary-dark text-body-lg text-ink-200 h-7.5 w-11 border-x bg-transparent text-center font-mono tabular-nums outline-none disabled:opacity-50"
        />
        <button
          type="button"
          aria-label={t('ui.stepper.increase', { label })}
          disabled={disabled || value >= max}
          onClick={() => {
            commit(value + step);
          }}
          className={buttonClass}
        >
          <Plus aria-hidden className={ICON_MD} size={16} />
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
