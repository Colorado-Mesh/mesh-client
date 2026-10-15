import { type RefObject, useCallback, useMemo } from 'react';

import { errLikeToLogString } from '../../lib/errLikeToLogString';
import {
  isMeshcoreRemoteCliAllowed,
  type MeshcoreContactFlagConnection,
  readMeshcoreRadioContactFlags,
  setMeshcoreRadioContactFlag,
} from '../../lib/meshcore/meshcoreContactFlags';
import type { MeshcoreRepeaterCliOptions } from '../../lib/meshcore/meshcoreHookTypes';
import { MESHCORE_CONTACT_FLAG_REMOTE_CLI } from '../../lib/meshcoreTelemetryPrivacy';

export interface MeshcoreCompanionRemoteActions {
  /** Whether our radio lets this contact run CLI commands on it; null when not on the radio. */
  getRemoteCliAllowed(nodeId: number): Promise<boolean | null>;
  /** Set or clear contact flag 0x10 on our radio; null when the contact is not on the radio. */
  setRemoteCliAllowed(nodeId: number, allowed: boolean): Promise<boolean | null>;
  /** Run a CLI command on another v1.18+ companion that allows us (txt_type 3). */
  sendRemoteCli(
    nodeId: number,
    command: string,
    opts?: MeshcoreRepeaterCliOptions,
  ): Promise<string>;
}

export interface UseMeshcoreCompanionRemoteDeps {
  connRef: RefObject<MeshcoreContactFlagConnection | null>;
  sendRepeaterCliCommand: (
    nodeId: number,
    command: string,
    opts?: MeshcoreRepeaterCliOptions,
  ) => Promise<string>;
}

export function useMeshcoreCompanionRemote(
  deps: UseMeshcoreCompanionRemoteDeps,
): MeshcoreCompanionRemoteActions {
  const { connRef, sendRepeaterCliCommand } = deps;

  const getRemoteCliAllowed = useCallback(
    async (nodeId: number): Promise<boolean | null> => {
      const conn = connRef.current;
      if (!conn) throw new Error('MeshCore not connected');
      const flags = await readMeshcoreRadioContactFlags(conn, nodeId);
      return flags == null ? null : isMeshcoreRemoteCliAllowed(flags);
    },
    [connRef],
  );

  const setRemoteCliAllowed = useCallback(
    async (nodeId: number, allowed: boolean): Promise<boolean | null> => {
      const conn = connRef.current;
      if (!conn) throw new Error('MeshCore not connected');
      try {
        const flags = await setMeshcoreRadioContactFlag(
          conn,
          nodeId,
          MESHCORE_CONTACT_FLAG_REMOTE_CLI,
          allowed,
        );
        console.debug(
          `[useMeshcoreCompanionRemote] remote CLI ${allowed ? 'allowed' : 'revoked'} node=0x${nodeId.toString(16)} flags=${flags ?? 'not-on-radio'}`,
        );
        return flags == null ? null : isMeshcoreRemoteCliAllowed(flags);
      } catch (e) {
        console.warn(
          '[useMeshcoreCompanionRemote] set remote CLI flag failed ' + errLikeToLogString(e),
        );
        throw e;
      }
    },
    [connRef],
  );

  const sendRemoteCli = useCallback(
    (nodeId: number, command: string, opts?: MeshcoreRepeaterCliOptions): Promise<string> =>
      sendRepeaterCliCommand(nodeId, command, { ...opts, target: 'companion' }),
    [sendRepeaterCliCommand],
  );

  return useMemo(
    () => ({ getRemoteCliAllowed, setRemoteCliAllowed, sendRemoteCli }),
    [getRemoteCliAllowed, setRemoteCliAllowed, sendRemoteCli],
  );
}
