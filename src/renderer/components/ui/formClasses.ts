/**
 * Shared class strings for native form controls (style guide, Controls). Use these instead of
 * one-off input/select/checkbox styling so every form reads the same.
 */

/**
 * Background, border, focus, invalid and disabled treatment shared by every text control. It sets
 * no size: use the `*_CLASS` / `*_BOX_CLASS` constants below, which add height, padding and text.
 */
export const FIELD_SURFACE_CLASS =
  'bg-app-bg border-secondary-dark placeholder:text-muted focus:border-brand-green aria-invalid:border-red-500 rounded-lg border text-zinc-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Text, number and search input without a width, for inputs sized by their row (`w-24`, `flex-1`). 32px, 40px on touch. */
export const INPUT_BOX_CLASS = `${FIELD_SURFACE_CLASS} h-8 px-2.5 text-body pointer-coarse:h-10`;

/** Compact input for dense rows and tables (28px, 12px text). */
export const INPUT_BOX_SM_CLASS = `${FIELD_SURFACE_CLASS} h-7 px-2 text-xs pointer-coarse:h-9`;

/** Full-width text, number and search input. */
export const INPUT_CLASS = `${INPUT_BOX_CLASS} w-full`;

/** Native `<select>` without a width: same box as inputs. */
export const SELECT_BOX_CLASS = `${FIELD_SURFACE_CLASS} h-8 px-2 text-body pointer-coarse:h-10`;

/** Compact native `<select>`. */
export const SELECT_BOX_SM_CLASS = `${FIELD_SURFACE_CLASS} h-7 px-1.5 text-xs pointer-coarse:h-9`;

/** Full-width native `<select>`. */
export const SELECT_CLASS = `${SELECT_BOX_CLASS} w-full`;

/** Multi-line text without a width. */
export const TEXTAREA_BOX_CLASS = `${FIELD_SURFACE_CLASS} px-2.5 py-2 text-body`;

/** Compact multi-line text (keys, logs, config blobs). */
export const TEXTAREA_BOX_SM_CLASS = `${FIELD_SURFACE_CLASS} px-2 py-1.5 text-xs`;

/** Full-width multi-line text. */
export const TEXTAREA_CLASS = `${TEXTAREA_BOX_CLASS} w-full`;

/** Field label above a control. */
export const FIELD_LABEL_CLASS = 'text-muted text-xs';

/** Checkbox: brand accent, 16px. */
export const CHECKBOX_CLASS = 'accent-brand-green h-4 w-4 shrink-0';

/** Small toggle chip (`aria-pressed`) for presets and regions; `sm` fits inside list rows. */
export function chipClass(active: boolean, size: 'sm' | 'md' = 'md'): string {
  const box = size === 'sm' ? 'h-6 px-2 text-label' : 'h-7 px-2.5 text-control';
  return `${box} rounded-lg border font-medium transition-colors ${
    active
      ? 'border-brand-green/35 bg-brand-green/12 text-bright-green'
      : 'border-zinc-800 bg-deep-black text-zinc-300 hover:border-secondary-dark hover:text-zinc-100'
  }`;
}

/** Inline notices inside a panel. */
export const NOTICE_CLASS: Record<'info' | 'warn' | 'error' | 'success', string> = {
  info: 'rounded-lg border border-zinc-800 bg-app-bg px-3 py-2 text-xs text-zinc-300',
  warn: 'rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200',
  error: 'rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200',
  success: 'rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-xs text-green-300',
};
