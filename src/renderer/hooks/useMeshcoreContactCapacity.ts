/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  MESHCORE_CONTACTS_CRITICAL_THRESHOLD,
  MESHCORE_CONTACTS_WARNING_THRESHOLD,
} from '../lib/meshcoreUtils';

export type MeshcoreContactCapacityLevel = 'unknown' | 'normal' | 'warning' | 'critical';

export interface MeshcoreContactCapacitySummary {
  count: number | null;
  level: MeshcoreContactCapacityLevel;
  isWarning: boolean;
  isCritical: boolean;
}

export interface OffloadMeshcoreContactsResult {
  offloadedFromRadioCount: number | null;
  offloadedCount: number;
  reconciledCount: number | null;
  refreshFailed: boolean;
}

function summarizeMeshcoreContactCapacity(count: number | null): MeshcoreContactCapacitySummary {
  if (count === null) {
    return { count, level: 'unknown', isWarning: false, isCritical: false };
  }
  if (count >= MESHCORE_CONTACTS_CRITICAL_THRESHOLD) {
    return { count, level: 'critical', isWarning: true, isCritical: true };
  }
  if (count >= MESHCORE_CONTACTS_WARNING_THRESHOLD) {
    return { count, level: 'warning', isWarning: true, isCritical: false };
  }
  return { count, level: 'normal', isWarning: false, isCritical: false };
}

interface UseMeshcoreContactCapacityOptions {
  enabled?: boolean;
}

export function useMeshcoreContactCapacity(options: UseMeshcoreContactCapacityOptions = {}) {
  const { enabled = true } = options;
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCount = useCallback(async (opts?: { preserveOnError?: boolean }) => {
    const preserveOnError = opts?.preserveOnError ?? false;
    try {
      const count = await window.electronAPI.db.getMeshcoreContactCount();
      setContactCount(count);
      return count;
    } catch (e) {
      if (!preserveOnError) {
        setContactCount(null);
      }
      console.warn(
        '[useMeshcoreContactCapacity] getMeshcoreContactCount error:',
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
  }, []);

  const offloadAndReconcile = useCallback(
    async (
      refreshContacts?: () => Promise<void>,
      offloadFromRadio?: () => Promise<number>,
    ): Promise<OffloadMeshcoreContactsResult> => {
      setLoading(true);
      try {
        let offloadedFromRadioCount: number | null = null;
        if (offloadFromRadio) {
          const offloadFromRadioResult = await offloadFromRadio();
          offloadedFromRadioCount = offloadFromRadioResult;
        }

        const offloadedCount = await window.electronAPI.db.offloadAllMeshcoreContacts();

        let refreshFailed = false;
        if (refreshContacts) {
          try {
            await refreshContacts();
          } catch (e) {
            refreshFailed = true;
            console.warn(
              '[useMeshcoreContactCapacity] refreshContacts after offload failed:',
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        const reconciledCount = await refreshCount({ preserveOnError: true });
        return { offloadedFromRadioCount, offloadedCount, reconciledCount, refreshFailed };
      } finally {
        setLoading(false);
      }
    },
    [refreshCount],
  );

  useEffect(() => {
    if (!enabled) return;
    void refreshCount();
  }, [enabled, refreshCount]);

  const summary = useMemo(() => summarizeMeshcoreContactCapacity(contactCount), [contactCount]);

  return {
    contactCount,
    loading,
    refreshCount,
    offloadAndReconcile,
    summary,
  };
}
