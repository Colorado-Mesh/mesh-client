import {
  collectReticulumLocalInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  type ReticulumLocalInterfaceHealthOptions,
  type ReticulumLocalInterfaceInput,
} from './reticulumLocalInterfaceHealth';

/** Steady poll when all local interfaces are healthy. */
export const RETICULUM_LOCAL_HEALTH_POLL_MS = 30_000;

/** Poll while any enabled local USB/BLE interface is offline or stale. */
export const RETICULUM_LOCAL_HEALTH_FAST_POLL_MS = 5_000;

/** One-shot refreshes after stack start/restart while BLE RNode links settle. */
export const RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS = [
  2_000, 5_000, 10_000, 15_000, 25_000,
] as const;

/** BLE RNode may take ~25s to connect after stack start; show "connecting" not "offline" until then. */
export const RETICULUM_BLE_CONNECT_GRACE_MS = 30_000;

export function reticulumLocalHealthNeedsFastPoll(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): boolean {
  return (
    collectReticulumLocalInterfaceAlerts(interfaces, osSerialPorts, options).length > 0 ||
    collectReticulumLocalInterfaceConnecting(interfaces, osSerialPorts, options).length > 0
  );
}

export function pickReticulumLocalHealthPollMs(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): number {
  return reticulumLocalHealthNeedsFastPoll(interfaces, osSerialPorts, options)
    ? RETICULUM_LOCAL_HEALTH_FAST_POLL_MS
    : RETICULUM_LOCAL_HEALTH_POLL_MS;
}

/** Schedule extra interface polls while slow transports (e.g. BLE RNode) come online. */
export function scheduleReticulumLocalInterfaceBurst(
  refresh: () => void | Promise<void>,
): () => void {
  const timers = RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS.map((delay) =>
    window.setTimeout(() => {
      void refresh();
    }, delay),
  );
  return () => {
    for (const id of timers) {
      window.clearTimeout(id);
    }
  };
}
