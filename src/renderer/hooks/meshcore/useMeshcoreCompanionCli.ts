import { type RefObject, useCallback, useMemo } from 'react';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { errLikeToLogString } from '../../lib/errLikeToLogString';
import {
  formatMeshcoreCompanionCliForLog,
  isMeshcoreCompanionCliSupported,
  isMeshcoreCompanionSensitiveCommand,
  type MeshcoreCompanionCliConnection,
  type MeshcoreCompanionCliResult,
  runMeshcoreCompanionCli,
} from '../../lib/meshcore/meshcoreCompanionCli';
import { serializeMeshcoreUserMessage } from '../../lib/meshcore/meshcoreMessageI18n';

/** Gap between writing `reboot` and tearing down the transport so the frame flushes. */
export const MESHCORE_PLANNED_REBOOT_FLUSH_MS = 500;

export interface MeshcoreCompanionCliActions {
  /** Connected companion speaks CMD_RUN_CLI_COMMAND (protocol v14+). */
  available: boolean;
  run(command: string): Promise<MeshcoreCompanionCliResult>;
  /** Reboot the companion and reconnect automatically on the same transport. */
  rebootAndReconnect(): Promise<void>;
  /** Power off the companion; this is a manual disconnect (no auto-reconnect). */
  powerOff(): Promise<void>;
}

export interface UseMeshcoreCompanionCliDeps {
  connRef: RefObject<(MeshcoreCompanionCliConnection & { reboot(): Promise<void> }) | null>;
  companionProtocolVersion: number | null | undefined;
  plannedRebootRef: RefObject<boolean>;
  /**
   * Runtime connection-lost handler: tears down and starts the single-owner reconnect cycle.
   * Returns false when it skipped reconnecting (manual disconnect, BLE hold, no session).
   */
  connectionLostRef: RefObject<() => boolean>;
  disconnect: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function useMeshcoreCompanionCli(
  deps: UseMeshcoreCompanionCliDeps,
): MeshcoreCompanionCliActions {
  const { connRef, companionProtocolVersion, plannedRebootRef, connectionLostRef, disconnect } =
    deps;
  const sleep = deps.sleep ?? defaultSleep;
  const available = isMeshcoreCompanionCliSupported(companionProtocolVersion);

  const run = useCallback(
    async (command: string): Promise<MeshcoreCompanionCliResult> => {
      const conn = connRef.current;
      if (!conn) {
        throw new Error(serializeMeshcoreUserMessage({ key: 'meshcoreCompanionCli.notConnected' }));
      }
      if (!available) {
        throw new Error(
          serializeMeshcoreUserMessage({ key: 'meshcoreCompanionCli.requiresCliFirmware' }),
        );
      }
      try {
        const result = await runMeshcoreCompanionCli(conn, command);
        console.debug(
          '[useMeshcoreCompanionCli] ' + formatMeshcoreCompanionCliForLog(command, result.reply),
        );
        return result;
      } catch (e) {
        const detail = isMeshcoreCompanionSensitiveCommand(command)
          ? '[redacted]'
          : errLikeToLogString(e);
        console.warn(
          '[useMeshcoreCompanionCli] ' +
            formatMeshcoreCompanionCliForLog(command) +
            ' failed: ' +
            sanitizeLogMessage(detail),
        );
        throw e;
      }
    },
    [available, connRef],
  );

  const sendNoReply = useCallback(
    async (command: 'reboot' | 'poweroff'): Promise<void> => {
      const conn = connRef.current;
      if (!conn) return;
      try {
        if (available) {
          await runMeshcoreCompanionCli(conn, command, { expectNoReply: true });
        } else if (command === 'reboot') {
          await conn.reboot();
        } else {
          throw new Error('poweroff requires companion CLI (firmware v1.18+)');
        }
      } catch (e) {
        console.warn(`[useMeshcoreCompanionCli] ${command} send error ` + errLikeToLogString(e));
        throw e;
      }
    },
    [available, connRef],
  );

  const rebootAndReconnect = useCallback(async (): Promise<void> => {
    if (!connRef.current) return;
    plannedRebootRef.current = true;
    try {
      await sendNoReply('reboot');
    } catch {
      // catch-no-log-ok logged in sendNoReply; the link may already be gone, reconnect anyway
    }
    await sleep(MESHCORE_PLANNED_REBOOT_FLUSH_MS);
    if (!connectionLostRef.current()) plannedRebootRef.current = false;
  }, [connRef, plannedRebootRef, sendNoReply, sleep, connectionLostRef]);

  const powerOff = useCallback(async (): Promise<void> => {
    if (!connRef.current) return;
    plannedRebootRef.current = false;
    await sendNoReply('poweroff');
    await sleep(MESHCORE_PLANNED_REBOOT_FLUSH_MS);
    await disconnect();
  }, [connRef, plannedRebootRef, sendNoReply, sleep, disconnect]);

  return useMemo(
    () => ({ available, run, rebootAndReconnect, powerOff }),
    [available, run, rebootAndReconnect, powerOff],
  );
}
