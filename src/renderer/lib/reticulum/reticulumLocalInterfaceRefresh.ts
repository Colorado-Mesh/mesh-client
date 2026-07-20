import { MS_PER_SECOND } from '@/shared/timeConstants';

import {
  collectReticulumInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  type ReticulumLocalInterfaceHealthOptions,
  type ReticulumLocalInterfaceInput,
} from './reticulumLocalInterfaceHealth';

/** Steady poll when all local interfaces are healthy. */
export const RETICULUM_LOCAL_HEALTH_POLL_MS = 30 * MS_PER_SECOND;

/** Poll while any enabled local USB/BLE interface is offline or stale. */
export const RETICULUM_LOCAL_HEALTH_FAST_POLL_MS = 5 * MS_PER_SECOND;

/** One-shot refreshes after stack start/restart while BLE RNode links settle. */
export const RETICULUM_LOCAL_HEALTH_BURST_DELAYS_MS = [
  2 * MS_PER_SECOND,
  5 * MS_PER_SECOND,
  10 * MS_PER_SECOND,
  15 * MS_PER_SECOND,
  25 * MS_PER_SECOND,
  40 * MS_PER_SECOND,
  55 * MS_PER_SECOND,
] as const;

/**
 * BLE RNode may take up to the OS passkey window (~60s TX-read) after stack start;
 * show "connecting" not "offline" until then.
 */
export const RETICULUM_BLE_CONNECT_GRACE_MS = 60 * MS_PER_SECOND;

export function reticulumLocalHealthNeedsFastPoll(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
  options?: ReticulumLocalInterfaceHealthOptions,
): boolean {
  return (
    collectReticulumInterfaceAlerts(interfaces, osSerialPorts, options).length > 0 ||
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
