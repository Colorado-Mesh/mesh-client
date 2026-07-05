import { serialPortMatchesPersistedIdentity } from './serialPortRecovery';
import type { MeshProtocol } from './types';

export interface SerialDisconnectTarget {
  isSerialConnected: () => boolean;
  onDisconnected: () => void;
}

const serialDisconnectTargets = new Map<MeshProtocol, SerialDisconnectTarget | null>();

/** Debounce duplicate per-port + global service disconnect notifications. */
let lastSerialDisconnectNotifyAt = 0;
const SERIAL_DISCONNECT_DEBOUNCE_MS = 500;

export function registerSerialDisconnectTarget(
  protocol: MeshProtocol,
  target: SerialDisconnectTarget | null,
): void {
  serialDisconnectTargets.set(protocol, target);
}

export function registerMeshtasticSerialDisconnectTarget(
  target: SerialDisconnectTarget | null,
): void {
  registerSerialDisconnectTarget('meshtastic', target);
}

export function registerMeshcoreSerialDisconnectTarget(
  target: SerialDisconnectTarget | null,
): void {
  registerSerialDisconnectTarget('meshcore', target);
}

export function routeSerialServiceDisconnect(port: SerialPort): void {
  if (!serialPortMatchesPersistedIdentity(port)) return;
  const now = Date.now();
  if (now - lastSerialDisconnectNotifyAt < SERIAL_DISCONNECT_DEBOUNCE_MS) return;

  let notified = false;
  const tryNotify = (target: SerialDisconnectTarget | null | undefined) => {
    if (notified || !target?.isSerialConnected()) return;
    notified = true;
    lastSerialDisconnectNotifyAt = now;
    target.onDisconnected();
  };

  for (const target of serialDisconnectTargets.values()) {
    tryNotify(target);
  }
}
