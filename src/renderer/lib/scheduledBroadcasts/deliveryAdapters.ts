import type { DeliverDeps } from './deliver';

/**
 * Delivery hooks that only React wiring can supply (the MeshCore runtime's room post). App
 * registers them once; everything else in `DeliverDeps` has a store/IPC-backed default.
 */
export type ScheduledBroadcastDeliveryAdapters = Partial<
  Pick<DeliverDeps, 'sendRoomPost' | 'sendChat' | 'sendRrc'>
>;

let adapters: ScheduledBroadcastDeliveryAdapters = {};

/** Replace the registered adapters. Pass `{}` (or call `clear…`) on unmount. */
export function setScheduledBroadcastDeliveryAdapters(
  next: ScheduledBroadcastDeliveryAdapters,
): void {
  adapters = next;
}

export function getScheduledBroadcastDeliveryAdapters(): ScheduledBroadcastDeliveryAdapters {
  return adapters;
}

export function clearScheduledBroadcastDeliveryAdapters(): void {
  adapters = {};
}
