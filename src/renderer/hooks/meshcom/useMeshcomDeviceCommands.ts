import { useCallback, useMemo } from 'react';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { connectionDriver } from '../../lib/drivers/ConnectionDriver';
import { errLikeToLogString } from '../../lib/errLikeToLogString';
import type { MeshComDeviceHandle } from '../../lib/protocols/MeshComProtocol';
import type { IdentityId } from '../../lib/types';

export interface MeshcomDeviceCommandsActions {
  /** True when the active MeshCom link is Serial or BLE. */
  available: boolean;
  transport: MeshComDeviceHandle['transport'] | null;
  run(command: string): Promise<{ command: string }>;
  /** Send `--settime` with the host's current UTC clock. */
  settimeNow(): Promise<{ command: string }>;
}

export interface UseMeshcomDeviceCommandsDeps {
  resolveIdentityId: () => IdentityId;
  /** Current connection transport from runtime state (udp/tcp/serial/ble). */
  connectionType: string | null | undefined;
}

export function useMeshcomDeviceCommands(
  deps: UseMeshcomDeviceCommandsDeps,
): MeshcomDeviceCommandsActions {
  const { resolveIdentityId, connectionType } = deps;

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

  return useMemo(
    () => ({
      available,
      transport,
      run,
      settimeNow,
    }),
    [available, transport, run, settimeNow],
  );
}
