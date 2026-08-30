import {
  isReticulumInterfaceOnlineStatus,
  isReticulumLocalSerialInterface,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { reticulumLocalHealthNeedsFastPoll } from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import {
  fetchReticulumInterfaces,
  fetchReticulumSerialPorts,
  type ReticulumSidecarInterfaceRow,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { aggregateReticulumLocalRfTxQueue } from '@/renderer/lib/reticulum/reticulumTxQueueAggregate';

export type ReticulumRrcTransportNotReadyReason =
  'no_online_egress' | 'local_interfaces_settling' | 'rnode_tx_buffering';

export interface ReticulumRrcTransportProbe {
  ready: boolean;
  reason?: ReticulumRrcTransportNotReadyReason;
}

function isOnlineEgressInterface(row: ReticulumSidecarInterfaceRow): boolean {
  if (!row.enabled || !isReticulumInterfaceOnlineStatus(row.status)) {
    return false;
  }
  const type = row.type.toLowerCase();
  return type === 'tcp' || type === 'i2p' || isReticulumLocalSerialInterface(type);
}

function isOnlineTcpEgressInterface(row: ReticulumSidecarInterfaceRow): boolean {
  return (
    row.enabled && row.type.toLowerCase() === 'tcp' && isReticulumInterfaceOnlineStatus(row.status)
  );
}

/**
 * True when at least one egress interface is online.
 * RNode settling/buffering gates apply only when TCP is not up (RF-only egress).
 */
export function evaluateReticulumRrcTransportReady(
  interfaces: readonly ReticulumSidecarInterfaceRow[],
  osSerialPorts: readonly string[],
): ReticulumRrcTransportProbe {
  if (!interfaces.some(isOnlineEgressInterface)) {
    return { ready: false, reason: 'no_online_egress' };
  }
  if (interfaces.some(isOnlineTcpEgressInterface)) {
    return { ready: true };
  }
  if (reticulumLocalHealthNeedsFastPoll(interfaces, osSerialPorts)) {
    return { ready: false, reason: 'local_interfaces_settling' };
  }
  const queue = aggregateReticulumLocalRfTxQueue(interfaces);
  if (queue?.buffering) {
    return { ready: false, reason: 'rnode_tx_buffering' };
  }
  return { ready: true };
}

export async function probeReticulumRrcTransportReady(): Promise<ReticulumRrcTransportProbe> {
  const [interfaces, osSerialPorts] = await Promise.all([
    fetchReticulumInterfaces({ bypassCache: true }),
    fetchReticulumSerialPorts(),
  ]);
  return evaluateReticulumRrcTransportReady(interfaces, osSerialPorts);
}
