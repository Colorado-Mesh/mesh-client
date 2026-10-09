import { useCallback, useEffect, useState } from 'react';

import type { TakStyleSettings } from '@/shared/tak-types';

import { takIpcErrorMessage } from './useTakRemoteRelay';

interface UseTakStyleSettingsResult {
  /** Saved settings; undefined until loaded. */
  settings: TakStyleSettings | undefined;
  isSaving: boolean;
  error: string | null;
  /** Resolves true once main saved and applied the settings. */
  save: (settings: TakStyleSettings) => Promise<boolean>;
}

/** Relayed-node style settings for the TAK panel; main validates, persists, and applies them. */
export function useTakStyleSettings(): UseTakStyleSettingsResult {
  const [settings, setSettings] = useState<TakStyleSettings | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.tak
      .getStyleSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSettings({ filters: [], sendUnmatched: true });
        setError(takIpcErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: TakStyleSettings) => {
    setIsSaving(true);
    setError(null);
    try {
      setSettings(await window.electronAPI.tak.setStyleSettings(next));
      return true;
    } catch (e) {
      const message = takIpcErrorMessage(e);
      console.debug('[TakStyle] save failed: ' + message);
      setError(message);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { settings, isSaving, error, save };
}
