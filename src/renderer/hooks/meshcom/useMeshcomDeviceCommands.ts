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

interface SettingsByConnection {
  /** `${identityId}:${transport}` that owns `snap`. */
  key: string;
  /** Radio handle that produced `snap` (object identity); null when cleared. */
  handle: MeshComDeviceHandle | null;
  snap: MeshcomDeviceSettingsSnapshot | null;
}

function connectionSettingsKey(
  identityId: IdentityId,
  transport: MeshComDeviceHandle['transport'] | null,
): string {
  return `${identityId}:${transport ?? ''}`;
}

export function useMeshcomDeviceCommands(
  deps: UseMeshcomDeviceCommandsDeps,
): MeshcomDeviceCommandsActions {
  const { resolveIdentityId, connectionType, onSettings } = deps;
  const [settingsByConnection, setSettingsByConnection] = useState<SettingsByConnection>({
    key: '',
    handle: null,
    snap: null,
  });

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
  const identityId = resolveIdentityId();
  const settingsKey = connectionSettingsKey(identityId, transport);
  const activeHandle = connectionDriver.getHandle(identityId) as MeshComDeviceHandle | null;
  // Expose snapshot only for the same identity/transport *and* the same radio handle that
  // produced it — reconnect on the same key must not reuse a prior FWVER for the RM gate.
  const settings =
    settingsByConnection.key === settingsKey &&
    settingsByConnection.handle != null &&
    settingsByConnection.handle === activeHandle
      ? settingsByConnection.snap
      : null;

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
          'mcL0699 [useMeshcomDeviceCommands] ' +
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
    const refreshIdentityId = resolveIdentityId();
    const handle = connectionDriver.getHandle(refreshIdentityId) as MeshComDeviceHandle | null;
    if (!handle || (handle.transport !== 'serial' && handle.transport !== 'ble')) {
      setSettingsByConnection({
        key: connectionSettingsKey(refreshIdentityId, handle?.transport ?? null),
        handle: null,
        snap: null,
      });
      return null;
    }
    const startedTransport = handle.transport;
    const startedKey = connectionSettingsKey(refreshIdentityId, startedTransport);
    try {
      const { refreshMeshcomDeviceSettings } =
        await import('../../lib/meshcom/refreshMeshcomDeviceSettings');
      const snap = await refreshMeshcomDeviceSettings(handle, refreshIdentityId);
      const currentIdentity = resolveIdentityId();
      const current = connectionDriver.getHandle(currentIdentity) as MeshComDeviceHandle | null;
      // Do not commit if the user switched radios / transports while the refresh ran.
      if (
        currentIdentity !== refreshIdentityId ||
        !current ||
        current !== handle ||
        current.transport !== startedTransport
      ) {
        if (!current || (current.transport !== 'serial' && current.transport !== 'ble')) {
          setSettingsByConnection({
            key: connectionSettingsKey(currentIdentity, current?.transport ?? null),
            handle: null,
            snap: null,
          });
        }
        return null;
      }
      setSettingsByConnection({ key: startedKey, handle, snap });
      onSettings?.(snap);
      console.debug(
        '[useMeshcomDeviceCommands] settings refreshed call=' +
          sanitizeLogMessage(snap.callsign || '(none)'),
      );
      return snap;
    } catch (e) {
      console.warn(
        'mcL0700 [useMeshcomDeviceCommands] settings refresh failed ' + errLikeToLogString(e),
      );
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
