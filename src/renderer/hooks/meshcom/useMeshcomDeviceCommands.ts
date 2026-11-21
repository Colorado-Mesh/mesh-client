import { useCallback, useMemo, useState } from 'react';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { connectionDriver } from '../../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../../lib/errLikeToLogString';
import type { MeshcomDeviceSettingsSnapshot } from '../../lib/meshcom/meshcomDeviceSettings';
import type { MeshComDeviceHandle } from '../../lib/protocols/MeshComProtocol';
import type { IdentityId } from '../../lib/types';

export interface MeshcomDeviceCommandsActions {
  /** True when the active MeshCom link is Serial or BLE. */
  available: boolean;
  transport: MeshComDeviceHandle['transport'] | null;
  /** Last settings snapshot read from the radio (null until first refresh). */
  settings: MeshcomDeviceSettingsSnapshot | null;
  run(command: string): Promise<{ command: string }>;
  /** Send `--settime` with the host's current UTC clock. */
  settimeNow(): Promise<{ command: string }>;
  /** Read current node settings (`--info` / BLE HELLO) into {@link settings}. */
  refreshSettings(): Promise<MeshcomDeviceSettingsSnapshot | null>;
}

export interface UseMeshcomDeviceCommandsDeps {
  resolveIdentityId: () => IdentityId;
  /** Current connection transport from runtime state (udp/tcp/serial/ble). */
  connectionType: string | null | undefined;
  /** Called when a settings refresh yields a callsign / operator name. */
  onSettings?: (snap: MeshcomDeviceSettingsSnapshot) => void;
}

export function useMeshcomDeviceCommands(
  deps: UseMeshcomDeviceCommandsDeps,
): MeshcomDeviceCommandsActions {
  const { resolveIdentityId, connectionType, onSettings } = deps;
  const [settings, setSettings] = useState<MeshcomDeviceSettingsSnapshot | null>(null);

  const transport = useMemo((): MeshComDeviceHandle['transport'] | null => {
    if (
      connectionType === 'serial' ||
      connectionType === 'ble' ||
      connectionType === 'udp' ||
      connectionType === 'tcp'
    ) {
      return connectionType;
    }
    const handle = connectionDriver.getHandle(resolveIdentityId()) as MeshComDeviceHandle | null;
    return handle?.transport ?? null;
  }, [connectionType, resolveIdentityId]);

  const available = transport === 'serial' || transport === 'ble';

  const run = useCallback(
    async (command: string): Promise<{ command: string }> => {
      const handle = connectionDriver.getHandle(resolveIdentityId()) as MeshComDeviceHandle | null;
      if (!handle) {
        throw new Error('Not connected to MeshCom radio');
      }
      const { sendMeshcomDeviceCommand, formatMeshcomDeviceCommandForLog } =
        await import('../../lib/meshcom/meshcomDeviceCommands');
      try {
        const result = await sendMeshcomDeviceCommand(handle, command);
        console.debug(
          '[useMeshcomDeviceCommands] sent ' +
            sanitizeLogMessage(formatMeshcomDeviceCommandForLog(result.command)),
        );
        return result;
      } catch (e) {
        console.warn(
          '[useMeshcomDeviceCommands] ' +
            sanitizeLogMessage(formatMeshcomDeviceCommandForLog(command)) +
            ' failed: ' +
            sanitizeLogMessage(errLikeToLogString(e)),
        );
        throw e;
      }
    },
    [resolveIdentityId],
  );

  const settimeNow = useCallback(async () => {
    const { buildMeshcomSettimeCommand } = await import('../../lib/meshcom/meshcomCommandWire');
    return run(buildMeshcomSettimeCommand());
  }, [run]);

  const refreshSettings = useCallback(async (): Promise<MeshcomDeviceSettingsSnapshot | null> => {
    const identityId = resolveIdentityId();
    const handle = connectionDriver.getHandle(identityId) as MeshComDeviceHandle | null;
    if (!handle || (handle.transport !== 'serial' && handle.transport !== 'ble')) {
      setSettings(null);
      return null;
    }
    try {
      const { refreshMeshcomDeviceSettings } =
        await import('../../lib/meshcom/refreshMeshcomDeviceSettings');
      const snap = await refreshMeshcomDeviceSettings(handle, identityId);
      setSettings(snap);
      onSettings?.(snap);
      console.debug(
        '[useMeshcomDeviceCommands] settings refreshed call=' +
          sanitizeLogMessage(snap.callsign || '(none)'),
      );
      return snap;
    } catch (e) {
      console.warn('[useMeshcomDeviceCommands] settings refresh failed ' + errLikeToLogString(e));
      return null;
    }
  }, [onSettings, resolveIdentityId]);

  return useMemo(
    () => ({
      available,
      transport,
      settings,
      run,
      settimeNow,
      refreshSettings,
    }),
    [available, refreshSettings, run, settings, settimeNow, transport],
  );
}
