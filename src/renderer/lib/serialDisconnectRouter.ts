import { serialPortMatchesPersistedIdentity } from './serialPortRecovery';

export interface SerialDisconnectTarget {
  isSerialConnected: () => boolean;
  onDisconnected: () => void;
}

let meshtasticSerialDisconnectTarget: SerialDisconnectTarget | null = null;
let meshcoreSerialDisconnectTarget: SerialDisconnectTarget | null = null;

/** Debounce duplicate per-port + global service disconnect notifications. */
let lastSerialDisconnectNotifyAt = 0;
const SERIAL_DISCONNECT_DEBOUNCE_MS = 500;

export function registerMeshtasticSerialDisconnectTarget(
  target: SerialDisconnectTarget | null,
): void {
  meshtasticSerialDisconnectTarget = target;
}

export function registerMeshcoreSerialDisconnectTarget(
  target: SerialDisconnectTarget | null,
): void {
  meshcoreSerialDisconnectTarget = target;
}

export function routeSerialServiceDisconnect(port: SerialPort): void {
  if (!serialPortMatchesPersistedIdentity(port)) return;
  const now = Date.now();
  if (now - lastSerialDisconnectNotifyAt < SERIAL_DISCONNECT_DEBOUNCE_MS) return;

  let notified = false;
  const tryNotify = (target: SerialDisconnectTarget | null) => {
    if (notified || !target?.isSerialConnected()) return;
    notified = true;
    lastSerialDisconnectNotifyAt = now;
    target.onDisconnected();
  };

  tryNotify(meshtasticSerialDisconnectTarget);
  tryNotify(meshcoreSerialDisconnectTarget);
}
