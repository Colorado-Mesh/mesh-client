import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runConnectionPanelStorageMigrations } from '@/renderer/lib/connectionPanelStorageMigrations';
import { initializeSecureSecretsFailClosed } from '@/renderer/lib/secureSecretStorage';

import { Button } from './ui/Button';

/** Paint startup/recovery before migrating, and mount runtimes only after hydration. */
export function SecureSecretsStartup({
  children,
  prepare,
}: {
  children: ReactNode;
  prepare?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const startup = prepare
      ? prepare().then(initializeSecureSecretsFailClosed)
      : initializeSecureSecretsFailClosed();
    void startup
      .then(() => {
        if (!active) return;
        runConnectionPanelStorageMigrations();
        setState('ready');
      })
      .catch(() => {
        // catch-no-log-ok initializer logs a sanitized failure; show safe recovery copy
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [attempt, prepare]);

  if (state === 'ready') return children;
  return (
    <main className="bg-app-bg flex h-screen w-screen items-center justify-center p-4">
      {state === 'loading' ? (
        <output aria-busy="true">
          <h1 className="sr-only">{t('app.loadingApp')}</h1>
          <div className="bg-ink-700 h-8 w-8 animate-pulse rounded-full" aria-hidden />
        </output>
      ) : (
        <div role="alert" className="text-ink-200 max-w-md space-y-3 text-sm">
          <h1 className="text-lg font-semibold">{t('app.savedSettingsUnavailable')}</h1>
          <p>{t('app.savedSettingsRecovery')}</p>
          <Button
            variant="primary"
            aria-label={t('common.retry')}
            onClick={() => {
              setState('loading');
              setAttempt((value) => value + 1);
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
    </main>
  );
}
