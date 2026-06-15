/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  isMeshcoreOffloadAbortError,
  MeshcoreOffloadAbortedError,
  meshcoreOffloadAbortRemovedCount,
  type MeshcoreOffloadFromRadioOptions,
  type MeshcoreOffloadProgress,
  throwIfMeshcoreOffloadAborted,
} from '../lib/meshcoreOffload';
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

export type OffloadContactsFromRadioFn = (
  options?: MeshcoreOffloadFromRadioOptions,
) => Promise<number>;

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
  const [offloadProgress, setOffloadProgress] = useState<MeshcoreOffloadProgress | null>(null);
  const offloadAbortRef = useRef<AbortController | null>(null);
  const removedFromRadioRef = useRef(0);

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

  const cancelOffload = useCallback(() => {
    offloadAbortRef.current?.abort();
  }, []);

  const offloadAndReconcile = useCallback(
    async (
      refreshContacts?: () => Promise<void>,
      offloadFromRadio?: OffloadContactsFromRadioFn,
    ): Promise<OffloadMeshcoreContactsResult> => {
      offloadAbortRef.current?.abort();
      const controller = new AbortController();
      offloadAbortRef.current = controller;
      const { signal } = controller;

      setLoading(true);
      setOffloadProgress(null);
      removedFromRadioRef.current = 0;
      let radioOffloadStarted = false;
      let offloadedFromRadioCount: number | null = null;

      try {
        if (offloadFromRadio) {
          radioOffloadStarted = true;
          offloadedFromRadioCount = await offloadFromRadio({
            signal,
            onProgress: (progress) => {
              setOffloadProgress(progress);
              if (progress.phase === 'removing') {
                removedFromRadioRef.current = progress.current;
              }
            },
          });
          removedFromRadioRef.current = offloadedFromRadioCount;
        }

        throwIfMeshcoreOffloadAborted(signal, removedFromRadioRef.current);

        setOffloadProgress({ phase: 'reconciling', current: 0, total: 0 });
        const offloadedCount = await window.electronAPI.db.offloadAllMeshcoreContacts();

        throwIfMeshcoreOffloadAborted(signal, removedFromRadioRef.current);

        let refreshFailed = false;
        if (refreshContacts) {
          try {
            await refreshContacts();
          } catch (e) {
            if (isMeshcoreOffloadAbortError(e)) {
              throw e;
            }
            refreshFailed = true;
            console.warn(
              '[useMeshcoreContactCapacity] refreshContacts after offload failed:',
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        throwIfMeshcoreOffloadAborted(signal, removedFromRadioRef.current);

        const reconciledCount = await refreshCount({ preserveOnError: true });
        return { offloadedFromRadioCount, offloadedCount, reconciledCount, refreshFailed };
      } catch (e) {
        if (isMeshcoreOffloadAbortError(e)) {
          if (radioOffloadStarted && refreshContacts) {
            try {
              await refreshContacts();
            } catch (refreshErr) {
              console.warn(
                '[useMeshcoreContactCapacity] refreshContacts after offload cancel failed:',
                refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
              );
            }
          }
          await refreshCount({ preserveOnError: true });
          const removedFromRadio = Math.max(
            meshcoreOffloadAbortRemovedCount(e),
            removedFromRadioRef.current,
          );
          throw new MeshcoreOffloadAbortedError(removedFromRadio);
        }
        throw e;
      } finally {
        if (offloadAbortRef.current === controller) {
          offloadAbortRef.current = null;
        }
        setLoading(false);
        setOffloadProgress(null);
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
    offloadProgress,
    cancelOffload,
    refreshCount,
    offloadAndReconcile,
    summary,
  };
}
