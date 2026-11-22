import { errLikeToLogString } from './errLikeToLogString';
import { cancelProtocolRfAutoConnect } from './protocolRfAutoConnectGate';
import { getRegisteredSerialDisconnectTargets } from './serialDisconnectRouter';
import {
  getPortSignature,
  loadLastSerialPortSignature,
  signaturesEqual,
} from './serialPortSignature';
import type { MeshProtocol } from './types';

const LORA_SERIAL_PROTOCOLS: readonly MeshProtocol[] = ['meshtastic', 'meshcore', 'meshcom'];

function portConflictsWithClaim(held: SerialPort | null | undefined, claim: SerialPort): boolean {
  if (held) {
    if (held === claim) return true;
    return signaturesEqual(getPortSignature(held), getPortSignature(claim));
  }
  // No live port handle — fall back to shared last-USB signature (Meshtastic/MeshCore share it;
  // MeshCom also persists into it on open). Different USB devices must not yield.
  return signaturesEqual(loadLastSerialPortSignature(), getPortSignature(claim));
}

/**
 * Before opening `port` for `claimingProtocol`, disconnect any other LoRa protocol that currently
 * holds the same Web Serial device so Chromium can release locked streams.
 */
export async function releaseConflictingSerialSessions(
  claimingProtocol: MeshProtocol,
  port: SerialPort,
): Promise<void> {
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
