/**
 * Toast helper for {@link handleReticulumQrIngest} outcomes (Network / Chat / deep-link host).
 */

import type { ReticulumQrIngestOutcome } from '@/renderer/lib/reticulum/handleReticulumQrIngest';

export function showReticulumQrIngestToast(
  outcome: ReticulumQrIngestOutcome,
  opts: {
    t: (key: string, params?: Record<string, string>) => string;
    addToast: (message: string, variant: 'success' | 'error') => void;
  },
): boolean {
  if (!outcome.handled) return false;
  opts.addToast(opts.t(outcome.toast.key, outcome.toast.params), outcome.toast.variant);
  return true;
}
