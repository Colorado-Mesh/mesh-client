/**
 * Isolates ReticulumPeerDetailModal so a render failure cannot take down App.
 * Resets when `peerHash` changes; Close clears selection via `onClose`.
 */
import { type ReactNode, Suspense } from 'react';

import ErrorBoundary from '@/renderer/components/ErrorBoundary';
import i18n from '@/renderer/lib/i18n';

interface Props {
  peerHash: string;
  onClose: () => void;
  children: ReactNode;
  suspenseFallback: ReactNode;
}

export function ReticulumPeerDetailErrorBoundary({
  peerHash,
  onClose,
  children,
  suspenseFallback,
}: Props) {
  return (
    <ErrorBoundary
      resetKeys={[peerHash]}
      fallback={({ error, resetError }) => (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={i18n.t('errorBoundary.title')}
        >
          <div className="w-full max-w-md space-y-4 rounded-lg border border-red-800 bg-slate-900 p-6 shadow-xl">
            <div className="text-lg font-semibold text-red-400">
              {i18n.t('errorBoundary.title')}
            </div>
            <p className="font-mono text-sm break-words text-red-300" role="alert">
              {error?.message || i18n.t('errorBoundary.unexpectedError')}
            </p>
            <button
              type="button"
              aria-label={i18n.t('aria.closeDialog')}
              className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600"
              onClick={() => {
                resetError();
                onClose();
              }}
            >
              {i18n.t('common.close')}
            </button>
          </div>
        </div>
      )}
    >
      <Suspense fallback={suspenseFallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}
