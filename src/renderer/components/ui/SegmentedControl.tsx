import type { KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';

import { StatusDot, type StatusDotTone } from './StatusDot';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Mono count after the label (filter segments: "Online 174"). */
  count?: number;
  /** Status dot before the label. */
  dot?: StatusDotTone;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Segmented single choice (`role="radiogroup"`): filter segments, connection type, section-like
 * switches inside a panel. Arrow keys move and select; only the checked segment is in tab order.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'sm',
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: T) => {
    const index = enabled.findIndex((o) => o.value === current);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    onChange(target.value);
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-segment-value="${CSS.escape(target.value)}"]`)
      ?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`bg-deep-black flex w-fit max-w-full shrink-0 [scrollbar-width:none] gap-0.5 overflow-x-auto rounded-lg border border-slate-800 p-0.75 ${className ?? ''}`}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.count !== undefined ? `${option.label} ${option.count}` : undefined}
            disabled={option.disabled}
            data-segment-value={option.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
            onKeyDown={(e) => {
              handleKeyDown(e, option.value);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              size === 'md' ? 'text-body h-7.5' : 'text-control h-6'
            } ${
              checked
                ? 'bg-sidebar-active-bg text-slate-200'
                : 'text-slate-300 hover:text-slate-100'
            }`}
          >
            {option.dot && <StatusDot tone={option.dot} />}
            {option.icon}
            {option.label}
            {option.count !== undefined && (
              <span
                className={`text-meta font-mono tabular-nums ${checked ? 'text-slate-300' : 'text-muted'}`}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
