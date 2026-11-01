import { type ComponentType, lazy, type ReactNode, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ErrorBoundary from '@/renderer/components/ErrorBoundary';
import { Z_NODE_DETAIL_MODAL } from '@/renderer/lib/modalZIndex';

export interface LazyDefaultExport<P extends object> {
  default: ComponentType<P>;
}

export type LazyLoader<P extends object> = () => Promise<LazyDefaultExport<P>>;

interface RetryableLazyProps<P extends object> {
  loader: LazyLoader<P>;
  fallback: ReactNode;
  /** Compact fixed strip (always-on overlays). Default is a centered dialog-style card. */
  errorVariant?: 'dialog' | 'strip';
  children: (Component: ComponentType<P>) => ReactNode;
}

/**
 * Suspense + ErrorBoundary for a `React.lazy` import that can be retried after failure.
 * Each retry builds a fresh `lazy(loader)` so a cached rejection is not reused.
 */
export function RetryableLazy<P extends object>({
  loader,
  fallback,
  errorVariant = 'dialog',
  children,
}: RetryableLazyProps<P>) {
  const [attempt, setAttempt] = useState(0);
  // New lazy() per attempt — React.lazy caches rejected imports on the same exotic component.
  const LazyComponent = useMemo(
    () =>
      lazy(() => {
        if (attempt < 0) {
          return Promise.reject(new Error('RetryableLazy: invalid attempt'));
        }
        return loader();
      }),
    [loader, attempt],
  );

  return (
    <ErrorBoundary
      resetKeys={[attempt]}
      fallback={({ error, resetError }) => (
        <LazyLoadErrorFallback
          variant={errorVariant}
          error={error}
          onRetry={() => {
            setAttempt((n) => n + 1);
            resetError();
          }}
        />
      )}
    >
      <Suspense fallback={fallback}>{children(LazyComponent)}</Suspense>
    </ErrorBoundary>
  );
}

function LazyLoadErrorFallback({
  variant,
  error,
  onRetry,
}: {
  variant: 'dialog' | 'strip';
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (variant === 'strip') {
    return (
      <div
        className="border-ink-700 bg-ink-900 shadow-level-3 fixed right-3 bottom-3 z-50 max-w-sm rounded-lg border px-3 py-2"
        role="alert"
      >
        <p className="text-ink-300 text-xs break-words">
          {error?.message || t('errorBoundary.unexpectedError')}
        </p>
        <button
          type="button"
          className="bg-ink-700 text-ink-200 hover:bg-ink-600 mt-2 rounded px-2 py-1 text-xs font-medium"
          onClick={onRetry}
          aria-label={t('errorBoundary.tryAgain')}
        >
          {t('errorBoundary.tryAgain')}
        </button>
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      style={{ zIndex: Z_NODE_DETAIL_MODAL }}
      role="dialog"
      aria-modal="true"
      aria-label={t('errorBoundary.title')}
    >
      <div className="shadow-level-4 bg-ink-900 w-full max-w-md space-y-3 rounded-lg border border-red-800 p-5">
        <div className="text-lg font-semibold text-red-400">{t('errorBoundary.title')}</div>
        <p className="font-mono text-sm break-words text-red-300" role="alert">
          {error?.message || t('errorBoundary.unexpectedError')}
        </p>
        <button
          type="button"
          className="bg-ink-700 text-ink-200 hover:bg-ink-600 rounded-lg px-4 py-2 text-sm font-medium"
          onClick={onRetry}
          aria-label={t('errorBoundary.tryAgain')}
        >
          {t('errorBoundary.tryAgain')}
        </button>
      </div>
    </div>
  );
}
