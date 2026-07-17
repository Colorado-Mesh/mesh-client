/**
 * Sticky per-hub suppress for RRC manual Disconnect.
 * Survives clearHubSession so hub auto-join does not immediately reconnect.
 * Cleared only on explicit Connect (not auto-join). In-memory only — cold start allows auto-join again.
 */

const suppressedHubs = new Set<string>();

function normHub(hub: string): string {
  return hub.trim().toLowerCase();
}

export function setRrcHubDisconnectSuppressed(hub: string, suppressed: boolean): void {
  const h = normHub(hub);
  if (!h) return;
  if (suppressed) suppressedHubs.add(h);
  else suppressedHubs.delete(h);
}

export function isRrcHubDisconnectSuppressed(hub: string): boolean {
  const h = normHub(hub);
  return Boolean(h) && suppressedHubs.has(h);
}

export function resetRrcHubDisconnectSuppressForTests(): void {
  suppressedHubs.clear();
}
