/** Visual states for the flash → provision → set-hash workflow buttons. */
export type FlasherStepButtonState = 'disabled' | 'ready' | 'busy' | 'done';

export function flasherStepButtonClass(state: FlasherStepButtonState): string {
  const base = 'rounded px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed';
  switch (state) {
    case 'disabled':
      return `${base} border border-gray-600 text-gray-200 disabled:opacity-60`;
    case 'ready':
      return `${base} bg-brand-green text-app-bg hover:bg-brand-green/90`;
    case 'busy':
      return `${base} bg-brand-green/80 text-app-bg`;
    case 'done':
      return `${base} bg-brand-green text-app-bg hover:bg-brand-green/90`;
  }
}
