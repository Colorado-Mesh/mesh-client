import {
  isReticulumInterfaceOnlineStatus,
  isReticulumLocalSerialInterface,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import type { ProtocolRuntimeQueueStatus } from '@/renderer/runtime/protocolRuntime';

/** Interface fields needed to pick worst local-RF host TX fill. */
export interface ReticulumTxQueueIfaceInput {
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  tx_queue_used?: number | null;
  tx_queue_max?: number | null;
}

export interface ReticulumTxQueueAggregate extends ProtocolRuntimeQueueStatus {
  /** Worst-fill interface display name (for tooltip). */
  interfaceName: string;
  /** True when any scoped local RF interface has used > 0. */
  buffering: boolean;
}

function fillRatio(used: number, max: number): number {
  return max > 0 ? used / max : 0;
}

/**
 * Worst host TX fill among enabled+online local RF interfaces (rnode / rnode_multi / kiss).
 * Excludes TCP/I2P/Auto hubs. Tie-break: higher used, then lexicographic name.
 */
export function aggregateReticulumLocalRfTxQueue(
  interfaces: readonly ReticulumTxQueueIfaceInput[] | null | undefined,
): ReticulumTxQueueAggregate | null {
  if (!interfaces || interfaces.length === 0) {
    return null;
  }

  let best: {
    name: string;
    used: number;
    max: number;
    ratio: number;
  } | null = null;
  let anyBuffering = false;

  for (const row of interfaces) {
    if (!row.enabled || !isReticulumLocalSerialInterface(row.type)) {
      continue;
    }
    if (!isReticulumInterfaceOnlineStatus(row.status)) {
      continue;
    }
    const max = row.tx_queue_max;
    const usedRaw = row.tx_queue_used;
    if (
      max == null ||
      usedRaw == null ||
      typeof max !== 'number' ||
      typeof usedRaw !== 'number' ||
      !Number.isFinite(max) ||
      !Number.isFinite(usedRaw) ||
      max <= 0 ||
      usedRaw < 0
    ) {
      continue;
    }
    const used = Math.min(usedRaw, max);
    if (used > 0) {
      anyBuffering = true;
    }
    const ratio = fillRatio(used, max);
    if (
      !best ||
      ratio > best.ratio ||
      (ratio === best.ratio && used > best.used) ||
      (ratio === best.ratio && used === best.used && row.name < best.name)
    ) {
      best = { name: row.name, used, max, ratio };
    }
  }

  if (!best) {
    return null;
  }

  return {
    free: best.max - best.used,
    maxlen: best.max,
    res: 0,
    interfaceName: best.name,
    buffering: anyBuffering,
  };
}
