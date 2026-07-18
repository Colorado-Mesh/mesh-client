import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';

import { useToast } from './Toast';

interface ReticulumStackAutostartCoordinatorProps {
  connecting: boolean;
  onStartStack: () => Promise<void>;
  enabled?: boolean;
}

/**
 * Keeps Reticulum sidecar autostart alive while ConnectionPanel is tab-mounted only for the
 * active protocol. Without this, cold start on Meshtastic/MeshCore never starts the stack.
 * Also surfaces hung-sidecar watchdog toasts (process alive, HTTP unresponsive).
 */
export function ReticulumStackAutostartCoordinator({
  connecting,
  onStartStack,
  enabled = true,
}: ReticulumStackAutostartCoordinatorProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const lastUnhealthyToastAtRef = useRef(0);

  useReticulumSidecarApi({
    connecting,
    onStartStack,
    enableAutostart: enabled,
  });

  useEffect(() => {
    const unsub = window.electronAPI.reticulum.onStatus((status) => {
      if (status.running && status.healthy === false) {
        const now = Date.now();
        // Avoid toast spam while the watchdog retries.
        if (now - lastUnhealthyToastAtRef.current < 30_000) return;
        lastUnhealthyToastAtRef.current = now;
        addToast(t('connectionPanel.reticulumSidecarUnhealthyRestarting'), 'warning', 6000);
      }
    });
    return () => {
      unsub();
    };
  }, [addToast, t]);

  return null;
}
