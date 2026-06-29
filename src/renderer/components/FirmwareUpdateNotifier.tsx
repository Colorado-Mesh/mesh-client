import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { protocolRecord, selectByProtocol } from '@/renderer/lib/appProtocolSelect';
import {
  fetchLatestMeshCoreRelease,
  fetchLatestMeshtasticRelease,
  type FirmwareCheckResult,
  meshCoreFirmwareUpdateAvailable,
  semverGt,
} from '@/renderer/lib/firmwareCheck';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import type { DeviceState, MeshProtocol } from '@/renderer/lib/types';

import { useToast } from './Toast';

const fetchLatestReleaseByProtocol = protocolRecord(
  fetchLatestMeshtasticRelease,
  fetchLatestMeshCoreRelease,
);

function isUpdateAvailable(
  capabilities: ProtocolCapabilities,
  firmwareVersion: string,
  release: { version: string; publishedAt?: Date },
): boolean {
  if (capabilities.prefersDeviceOwnerLongNameInHeader) {
    return meshCoreFirmwareUpdateAvailable(firmwareVersion, {
      version: release.version,
      publishedAt: release.publishedAt ?? new Date(0),
    });
  }
  return semverGt(release.version, firmwareVersion);
}

export interface FirmwareUpdateNotifierProps {
  deviceStateByProtocol: Record<MeshProtocol, DeviceState>;
  capabilitiesByProtocol: Record<MeshProtocol, ProtocolCapabilities>;
  activeProtocol: MeshProtocol;
  onResult: (r: FirmwareCheckResult) => void;
}

/** Check upstream firmware releases when the active protocol radio reaches configured. */
export function FirmwareUpdateNotifier({
  deviceStateByProtocol,
  capabilitiesByProtocol,
  activeProtocol,
  onResult,
}: FirmwareUpdateNotifierProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const toastShownRef = useRef(false);
  const activeState = selectByProtocol(deviceStateByProtocol, activeProtocol);
  const activeCapabilities = selectByProtocol(capabilitiesByProtocol, activeProtocol);

  useEffect(() => {
    const { status, firmwareVersion } = activeState;
    if (status !== 'configured' || !firmwareVersion || !activeCapabilities.hasFirmwareUpdateCheck) {
      return;
    }

    onResult({ phase: 'checking' });
    let cancelled = false;

    void selectByProtocol(fetchLatestReleaseByProtocol, activeProtocol)()
      .then((release) => {
        if (cancelled) return;
        const updateAvailable = isUpdateAvailable(activeCapabilities, firmwareVersion, release);
        onResult(
          updateAvailable
            ? {
                phase: 'update-available',
                latestVersion: release.version,
                releaseUrl: release.releaseUrl,
              }
            : {
                phase: 'up-to-date',
                latestVersion: release.version,
                releaseUrl: release.releaseUrl,
              },
        );
        if (updateAvailable && !toastShownRef.current) {
          toastShownRef.current = true;
          addToast(t('toasts.firmwareAvailable', { version: release.version }), 'warning', 8000);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(
          '[FirmwareUpdateNotifier] check failed:',
          err instanceof Error ? err.message : String(err),
        );
        onResult({ phase: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [activeState, activeCapabilities, activeProtocol, onResult, addToast, t]);

  useEffect(() => {
    if (activeState.status === 'disconnected') {
      onResult({ phase: 'idle' });
      toastShownRef.current = false;
    }
  }, [activeState.status, onResult]);

  return null;
}
