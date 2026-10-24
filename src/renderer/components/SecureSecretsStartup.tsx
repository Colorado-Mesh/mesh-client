import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { runConnectionPanelStorageMigrations } from '@/renderer/lib/connectionPanelStorageMigrations';
import { getPreparedRendererPreferences } from '@/renderer/lib/rendererPreferences';
import {
  forgetUnavailableStartupCredentials,
  getUnavailableStartupCredentialKeys,
  initializeSecureSecretsFailClosed,
  MESHCORE_IDENTITY_SECRET_KEY,
  MESHCORE_MQTT_SECRET_KEY,
  MESHTASTIC_MQTT_SECRET_KEY,
  MQTT_PROFILES_SECRET_KEY,
} from '@/renderer/lib/secureSecretStorage';

import { Button } from './ui/Button';

/** Paint startup/recovery before migrating, and mount runtimes only after hydration. */
export function SecureSecretsStartup({
  children,
  prepare,
  finish,
}: {
  children: ReactNode;
  prepare?: () => Promise<void>;
  finish?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [unavailableKeys, setUnavailableKeys] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetFailed, setForgetFailed] = useState(false);
  const mutationActive = useRef(false);
  const acknowledgeRef = useRef<HTMLInputElement>(null);
  const recoveryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) acknowledgeRef.current?.focus();
    else if (state === 'error') recoveryButtonRef.current?.focus();
  }, [confirming, state]);

  function retry() {
    setUnavailableKeys([]);
    setConfirming(false);
    setAcknowledged(false);
    setForgetFailed(false);
    setState('loading');
    setAttempt((value) => value + 1);
  }

  function credentialLabel(key: string): string {
    if (key === MESHTASTIC_MQTT_SECRET_KEY)
      return t('app.credentialMqtt', { protocol: 'Meshtastic' });
    if (key === MESHCORE_MQTT_SECRET_KEY) return t('app.credentialMqtt', { protocol: 'MeshCore' });
    if (key === MESHCORE_IDENTITY_SECRET_KEY) return t('app.credentialIdentity');
    if (key === MQTT_PROFILES_SECRET_KEY) return t('app.credentialProfiles');
    const [, kind, node] = key.split(':');
    return t(kind === 'room' ? 'app.credentialRoom' : 'app.credentialRepeater', { node });
  }

  async function forgetAndRetry() {
    if (!acknowledged || mutationActive.current || unavailableKeys.length === 0) return;
    mutationActive.current = true;
    setForgetting(true);
    setForgetFailed(false);
    try {
      await forgetUnavailableStartupCredentials(unavailableKeys);
      retry();
    } catch {
      // catch-no-log-ok never expose protected storage errors or credential values
      setUnavailableKeys(getUnavailableStartupCredentialKeys());
      setAcknowledged(false);
      setForgetFailed(true);
    } finally {
      mutationActive.current = false;
      setForgetting(false);
    }
  }

  useEffect(() => {
    let active = true;
    let secretsAttempted = false;
    const startup = (prepare ? prepare() : Promise.resolve())
      .then(() => {
        secretsAttempted = true;
        return initializeSecureSecretsFailClosed(getPreparedRendererPreferences());
      })
      .then(finish);
    void startup
      .then(() => {
        if (!active) return;
        runConnectionPanelStorageMigrations();
        setState('ready');
      })
      .catch(() => {
        // catch-no-log-ok initializer logs a sanitized failure; show safe recovery copy
        if (active) {
          setUnavailableKeys(secretsAttempted ? getUnavailableStartupCredentialKeys() : []);
          setState('error');
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, prepare, finish]);

  if (state === 'ready') return children;
  return (
    <main className="bg-app-bg flex h-screen w-full items-center justify-center overflow-y-auto p-4">
      {state === 'loading' ? (
        <output aria-busy="true">
          <h1 className="sr-only">{t('app.loadingApp')}</h1>
          <div className="bg-ink-700 h-8 w-8 animate-pulse rounded-full" aria-hidden />
        </output>
      ) : (
        <div role="alert" className="text-ink-200 my-auto max-w-md space-y-3 text-sm">
          <h1 className="text-lg font-semibold">
            {t(confirming ? 'app.forgetCredentialsTitle' : 'app.savedSettingsUnavailable')}
          </h1>
          <p>{t(confirming ? 'app.forgetCredentialsDescription' : 'app.savedSettingsRecovery')}</p>
          {confirming ? (
            <>
              <ul className="list-inside list-disc">
                {unavailableKeys.map((key) => (
                  <li key={key}>{credentialLabel(key)}</li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  ref={acknowledgeRef}
                  type="checkbox"
                  checked={acknowledged}
                  disabled={forgetting}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                  className="accent-brand-green mt-1 shrink-0"
                />
                {t('app.forgetCredentialsAcknowledge')}
              </label>
              {forgetFailed && <p>{t('app.forgetCredentialsFailed')}</p>}
              <div className="flex flex-wrap gap-3" aria-busy={forgetting}>
                <Button
                  disabled={forgetting}
                  onClick={() => {
                    setConfirming(false);
                    setAcknowledged(false);
                    setForgetFailed(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  disabled={!acknowledged || forgetting || unavailableKeys.length === 0}
                  onClick={() => {
                    void forgetAndRetry();
                  }}
                >
                  {t(forgetting ? 'common.loading' : 'app.forgetCredentialsConfirm')}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={retry}>
                {t('common.retry')}
              </Button>
              {unavailableKeys.length > 0 && (
                <Button
                  ref={recoveryButtonRef}
                  variant="danger"
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  {t('app.forgetUnavailableCredentials')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
