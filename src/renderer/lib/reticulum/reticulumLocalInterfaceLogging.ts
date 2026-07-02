import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import {
  classifyReticulumLocalInterface,
  type ReticulumLocalInterfaceHealth,
  type ReticulumLocalInterfaceInput,
  reticulumLocalOfflineDisplayKind,
} from './reticulumLocalInterfaceHealth';

const healthSnapshot = new Map<string, ReticulumLocalInterfaceHealth | null>();

function sanitizeField(value: string | null | undefined): string {
  return sanitizeLogMessage(value?.trim() || '—');
}

function formatInterfaceFields(iface: ReticulumLocalInterfaceInput): string {
  const port = iface.serial_port?.trim();
  const parts = [
    `id=${sanitizeField(iface.id)}`,
    `name=${sanitizeField(iface.name)}`,
    `type=${sanitizeField(iface.type)}`,
    `status=${sanitizeField(iface.status)}`,
  ];
  if (port) {
    parts.push(`port=${sanitizeField(port)}`);
  }
  return parts.join(' ');
}

function logHealthTransition(
  iface: ReticulumLocalInterfaceInput,
  health: ReticulumLocalInterfaceHealth,
  prev: ReticulumLocalInterfaceHealth | null | undefined,
): void {
  if (health === 'online') {
    if (prev != null && prev !== 'online') {
      console.debug(`[useReticulumRuntime] local interface online ${formatInterfaceFields(iface)}`);
    }
    return;
  }
  if (health === 'disabled' || health === null) {
    return;
  }
  if (health === 'stale_port') {
    console.warn(
      `[useReticulumRuntime] local interface stale port ${formatInterfaceFields(iface)}`,
    );
    return;
  }
  const transport = reticulumLocalOfflineDisplayKind(iface);
  console.warn(
    `[useReticulumRuntime] local interface offline ${formatInterfaceFields(iface)} transport=${transport}`,
  );
}

/** Emit debug-log lines when local interface health changes (deduped per interface id). */
export function logReticulumLocalInterfaceHealthChanges(
  interfaces: readonly ReticulumLocalInterfaceInput[],
  osSerialPorts: readonly string[],
): void {
  const seenIds = new Set<string>();
  for (const iface of interfaces) {
    seenIds.add(iface.id);
    const health = classifyReticulumLocalInterface(iface, osSerialPorts);
    const prev = healthSnapshot.get(iface.id);
    if (prev === health) {
      continue;
    }
    healthSnapshot.set(iface.id, health);
    logHealthTransition(iface, health, prev);
  }
  for (const id of healthSnapshot.keys()) {
    if (!seenIds.has(id)) {
      healthSnapshot.delete(id);
    }
  }
}

export function formatReticulumInterfaceStateEvent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'payload=invalid';
  }
  const p = payload as Record<string, unknown>;
  const action = typeof p.action === 'string' ? sanitizeField(p.action) : 'unknown';
  const id =
    typeof p.interface_id === 'string'
      ? sanitizeField(p.interface_id)
      : typeof p.id === 'string'
        ? sanitizeField(p.id)
        : '—';
  const error = typeof p.error === 'string' ? sanitizeField(p.error) : '';
  return error.length > 0
    ? `action=${action} id=${id} error=${error}`
    : `action=${action} id=${id}`;
}

/** Log sidecar `interface.state` websocket events (warn on failures). */
export function logReticulumInterfaceStateEvent(payload: unknown): void {
  const detail = formatReticulumInterfaceStateEvent(payload);
  const action =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { action?: unknown }).action === 'string'
      ? (payload as { action: string }).action
      : '';
  if (action === 'ble_peer_failed') {
    console.warn(`[useReticulumRuntime] interface.state ${detail}`);
    return;
  }
  console.debug(`[useReticulumRuntime] interface.state ${detail}`);
}

/** Test-only reset of dedupe snapshot. */
export function resetReticulumLocalInterfaceHealthSnapshotForTests(): void {
  healthSnapshot.clear();
}
