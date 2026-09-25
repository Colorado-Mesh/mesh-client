import { useCallback, useEffect, useState } from 'react';

import type {
  TAKRemoteCredentialSummary,
  TAKRemoteSettings,
  TAKRemoteStatus,
} from '@/shared/tak-types';

const IDLE_REMOTE_STATUS: TAKRemoteStatus = { state: 'disconnected', host: '', port: 8089 };

/** Electron prefixes errors thrown in main with "Error invoking remote method '<channel>': ". */
export function takIpcErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

/** Live remote relay status, for callers that only need to know whether it is running. */
export function useTakRemoteStatus(): TAKRemoteStatus {
  const [status, setStatus] = useState<TAKRemoteStatus>(IDLE_REMOTE_STATUS);
  useEffect(() => {
    // Set on unmount, or when a pushed status arrives first and is newer than the snapshot.
    let superseded = false;
    const unsubscribe = window.electronAPI.tak.onRemoteStatus((s) => {
      superseded = true;
      setStatus(s);
    });
    window.electronAPI.tak
      .remoteGetStatus()
      .then((s) => {
        if (!superseded) setStatus(s);
      })
      .catch((e: unknown) => {
        console.warn('[TakRemote] remoteGetStatus failed: ' + takIpcErrorMessage(e));
      });
    return () => {
      superseded = true;
      unsubscribe();
    };
  }, []);
  return status;
}

interface UseTakRemoteRelayResult {
  status: TAKRemoteStatus;
  /** Saved settings; undefined until loaded, null when none were saved. */
  savedSettings: TAKRemoteSettings | null | undefined;
  credentials: TAKRemoteCredentialSummary | null;
  isBusy: boolean;
  error: string | null;
  connect: (settings: TAKRemoteSettings) => Promise<void>;
  disconnect: () => Promise<void>;
  importCredentials: (password: string) => Promise<void>;
  clearCredentials: () => Promise<void>;
}

/** Remote TAK relay controls for the TAK panel. Key material stays in main. */
export function useTakRemoteRelay(): UseTakRemoteRelayResult {
  const status = useTakRemoteStatus();
  const [savedSettings, setSavedSettings] = useState<TAKRemoteSettings | null | undefined>(
    undefined,
  );
  const [credentials, setCredentials] = useState<TAKRemoteCredentialSummary | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.tak
      .remoteGetSettings()
      .then(setSavedSettings)
      .catch((e: unknown) => {
        setSavedSettings(null);
        setError(takIpcErrorMessage(e));
      });
    window.electronAPI.tak
      .remoteGetCredentials()
      .then(setCredentials)
      .catch((e: unknown) => {
        setError(takIpcErrorMessage(e));
      });
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const message = takIpcErrorMessage(e);
      console.debug('[TakRemote] action failed: ' + message);
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const connect = useCallback(
    (settings: TAKRemoteSettings) =>
      run(async () => {
        await window.electronAPI.tak.remoteStart(settings);
        setSavedSettings(settings);
      }),
    [run],
  );

  const disconnect = useCallback(
    () =>
      run(async () => {
        await window.electronAPI.tak.remoteStop();
      }),
    [run],
  );

  const importCredentials = useCallback(
    (password: string) =>
      run(async () => {
        const summary = await window.electronAPI.tak.remoteImportCredentials(password || undefined);
        if (summary) setCredentials(summary);
      }),
    [run],
  );

  const clearCredentials = useCallback(
    () =>
      run(async () => {
        setCredentials(await window.electronAPI.tak.remoteClearCredentials());
      }),
    [run],
  );

  return {
    status,
    savedSettings,
    credentials,
    isBusy,
    error,
    connect,
    disconnect,
    importCredentials,
    clearCredentials,
  };
}
