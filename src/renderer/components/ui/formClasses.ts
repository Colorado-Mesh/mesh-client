/**
 * Shared class strings for native form controls (style guide, Controls). Use these instead of
 * one-off input/select/checkbox styling so every form reads the same.
 */

/** Text, number and search inputs: 32px, app background, strong border, green focus ring. */
export const INPUT_CLASS =
  'bg-app-bg border-secondary-dark placeholder:text-muted focus:border-brand-green h-8 w-full rounded-lg border px-2.5 text-[13px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Native `<select>`: same box as inputs. */
export const SELECT_CLASS =
  'bg-app-bg border-secondary-dark focus:border-brand-green h-8 w-full rounded-lg border px-2 text-[13px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Multi-line text. */
export const TEXTAREA_CLASS =
  'bg-app-bg border-secondary-dark placeholder:text-muted focus:border-brand-green w-full rounded-lg border px-2.5 py-2 text-[13px] text-slate-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Field label above a control. */
export const FIELD_LABEL_CLASS = 'text-muted text-xs';

/** Checkbox: brand accent, 16px. */
export const CHECKBOX_CLASS = 'accent-brand-green h-4 w-4 shrink-0';

/** Small toggle chip (`aria-pressed`) for presets and regions. */
export function chipClass(active: boolean): string {
  return `h-7 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors ${
    active
      ? 'border-brand-green/35 bg-brand-green/12 text-bright-green'
      : 'border-slate-800 bg-deep-black text-slate-300 hover:border-secondary-dark hover:text-slate-100'
  }`;
}

/** Inline notices inside a panel. */
export const NOTICE_CLASS: Record<'info' | 'warn' | 'error' | 'success', string> = {
  info: 'rounded-lg border border-slate-800 bg-app-bg px-3 py-2 text-xs text-slate-300',
  warn: 'rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200',
  error: 'rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200',
  success:
    'rounded-lg border border-brand-green/35 bg-brand-green/10 px-3 py-2 text-xs text-bright-green',
};
