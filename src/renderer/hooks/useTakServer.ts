import { useEffect, useState } from 'react';

import type { TAKClientInfo, TAKServerStatus, TAKSettings } from '@/shared/tak-types';

const DEFAULT_SETTINGS: TAKSettings = {
  enabled: false,
  port: 8089,
  serverName: 'mesh-client',
  requireClientCert: true,
  autoStart: false,
};

interface UseTakServerResult {
  status: TAKServerStatus;
  clients: TAKClientInfo[];
  settings: TAKSettings;
  isLoading: boolean;
  error: string | null;
  setSettings: (s: TAKSettings) => void;
  start: (s: TAKSettings) => Promise<void>;
  stop: () => Promise<void>;
  generateDataPackage: () => Promise<void>;
  regenerateCertificates: () => Promise<void>;
}

export function useTakServer(): UseTakServerResult {
  const [status, setStatus] = useState<TAKServerStatus>({
    running: false,
    port: DEFAULT_SETTINGS.port,
    clientCount: 0,
  });
  const [clients, setClients] = useState<TAKClientInfo[]>([]);
  const [settings, setSettings] = useState<TAKSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI.tak
      .getStatus()
      .then(setStatus)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    void window.electronAPI.tak
      .getConnectedClients()
      .then(setClients)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });

    const unsubStatus = window.electronAPI.tak.onStatus((s) => {
      setStatus(s);
      if (s.error) setError(s.error);
      else setError(null);
    });
    const unsubConnected = window.electronAPI.tak.onClientConnected((client) => {
      setClients((prev) => [...prev, client]);
    });
    const unsubDisconnected = window.electronAPI.tak.onClientDisconnected((id) => {
      setClients((prev) => prev.filter((c) => c.id !== id));
    });

    return () => {
      unsubStatus();
      unsubConnected();
      unsubDisconnected();
    };
  }, []);

  const start = async (s: TAKSettings) => {
    setIsLoading(true);
    setError(null);
    try {
      await window.electronAPI.tak.start(s);
      setSettings(s);
    } catch (err) {
      console.debug('[TakServer] start error:', err instanceof Error ? err.message : err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const stop = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await window.electronAPI.tak.stop();
    } catch (err) {
      console.debug('[TakServer] stop error:', err instanceof Error ? err.message : err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const generateDataPackage = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await window.electronAPI.tak.generateDataPackage();
    } catch (err) {
      console.debug(
        '[TakServer] generateDataPackage error:',
        err instanceof Error ? err.message : err,
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const regenerateCertificates = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await window.electronAPI.tak.regenerateCertificates();
    } catch (err) {
      console.debug(
        '[TakServer] regenerateCertificates error:',
        err instanceof Error ? err.message : err,
      );
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return {
    status,
    clients,
    settings,
    isLoading,
    error,
    setSettings,
    start,
    stop,
    generateDataPackage,
    regenerateCertificates,
  };
}
