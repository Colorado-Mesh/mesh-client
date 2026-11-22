import { errLikeToLogString } from './errLikeToLogString';
import { cancelProtocolRfAutoConnect } from './protocolRfAutoConnectGate';
import { getRegisteredSerialDisconnectTargets } from './serialDisconnectRouter';
import {
  getPortSignature,
  loadLastSerialPortSignature,
  signaturesEqual,
} from './serialPortSignature';
import type { MeshProtocol } from './types';

export const LORA_SERIAL_PROTOCOLS: readonly MeshProtocol[] = ['meshtastic', 'meshcore', 'meshcom'];

export type LoraSerialConnectedSnapshot = Record<'meshtastic' | 'meshcore' | 'meshcom', boolean>;

function portConflictsWithClaim(held: SerialPort | null | undefined, claim: SerialPort): boolean {
  if (held) {
    if (held === claim) return true;
    return signaturesEqual(getPortSignature(held), getPortSignature(claim));
  }
  // No live port handle — fall back to shared last-USB signature (Meshtastic/MeshCore share it;
  // MeshCom also persists into it on open). Different USB devices must not yield.
  return signaturesEqual(loadLastSerialPortSignature(), getPortSignature(claim));
}

/** Whether each LoRa protocol currently reports an active serial RF session. */
export function snapshotLoraSerialConnected(): LoraSerialConnectedSnapshot {
  const targets = getRegisteredSerialDisconnectTargets();
  return {
    meshtastic: targets.get('meshtastic')?.isSerialConnected() === true,
    meshcore: targets.get('meshcore')?.isSerialConnected() === true,
    meshcom: targets.get('meshcom')?.isSerialConnected() === true,
  };
}

/** Log LoRa isSerialConnected flags (support-bundle triage for open failures). */
export function logLoraSerialConnectedSnapshot(
  phase: string,
  claimingProtocol: MeshProtocol,
): void {
  const snap = snapshotLoraSerialConnected();
  console.debug(
    `[serialPortClaim] ${phase} for ${claimingProtocol}; isSerialConnected=${JSON.stringify(snap)}`,
  );
}

let lastSerialClaimAttempt: { protocol: MeshProtocol; port: SerialPort } | null = null;

/** Last port passed to {@link releaseConflictingSerialSessions} for `claimingProtocol`, if any. */
export function peekLastSerialClaimPort(claimingProtocol: MeshProtocol): SerialPort | null {
  if (lastSerialClaimAttempt?.protocol !== claimingProtocol) return null;
  return lastSerialClaimAttempt.port;
}

/**
 * Other LoRa protocols that still report a serial hold matching `claimPort`.
 * When `claimPort` is null (attempted device unknown), returns [] so UI keeps the generic
 * external-lock hint instead of blaming an unrelated in-app session.
 */
export function listInAppSerialHolders(
  claimingProtocol: MeshProtocol,
  claimPort: SerialPort | null,
): MeshProtocol[] {
  if (!claimPort) return [];
  const targets = getRegisteredSerialDisconnectTargets();
  const holders: MeshProtocol[] = [];
  for (const protocol of LORA_SERIAL_PROTOCOLS) {
    if (protocol === claimingProtocol) continue;
    const target = targets.get(protocol);
    if (!target?.isSerialConnected()) continue;
    const held = target.getOpenSerialPort?.() ?? null;
    if (!portConflictsWithClaim(held, claimPort)) continue;
    holders.push(protocol);
  }
  return holders;
}

/**
 * Before opening `port` for `claimingProtocol`, disconnect any other LoRa protocol that currently
 * holds the same Web Serial device so Chromium can release locked streams.
 */
export async function releaseConflictingSerialSessions(
  claimingProtocol: MeshProtocol,
  port: SerialPort,
): Promise<void> {
  lastSerialClaimAttempt = { protocol: claimingProtocol, port };
  logLoraSerialConnectedSnapshot('open', claimingProtocol);
  const targets = getRegisteredSerialDisconnectTargets();
  for (const protocol of LORA_SERIAL_PROTOCOLS) {
    if (protocol === claimingProtocol) continue;
    const target = targets.get(protocol);
    if (!target?.isSerialConnected()) continue;
    const held = target.getOpenSerialPort?.() ?? null;
    if (!portConflictsWithClaim(held, port)) continue;
    if (!target.releaseHold) {
      console.warn(
        `[serialPortClaim] ${protocol} holds serial but has no releaseHold — cannot yield for ${claimingProtocol}`,
      );
      continue;
    }
    console.debug(
      `[serialPortClaim] ${protocol} yielding serial hold to ${claimingProtocol}` +
        (held ? ' (matched open port)' : ' (matched USB signature)'),
    );
    cancelProtocolRfAutoConnect(protocol);
    try {
      await target.releaseHold();
    } catch (e) {
      console.warn(
        `[serialPortClaim] ${protocol} releaseHold failed for ${claimingProtocol}: ${errLikeToLogString(e)}`,
      );
    }
  }
}

/** Cancel deferred RF auto-connect for every LoRa protocol (manual serial Connect race). */
export function cancelAllLoraRfAutoConnect(): void {
  for (const protocol of LORA_SERIAL_PROTOCOLS) {
    cancelProtocolRfAutoConnect(protocol);
  }
}
