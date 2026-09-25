import { useCallback, useEffect, useRef } from 'react';

import type { MeshProtocol } from '@/renderer/lib/types';
import { isMeshProtocol } from '@/shared/meshProtocol';

import {
  notifyChatOutboxRowsChanged,
  registerChatOutboxDrainListener,
} from '../lib/chatOutboxDrain';
import {
  type ChatOutboxSendFn,
  drainChatOutboxOnce,
  earliestEmergencyRetryAt,
  isEmergencyOutboxPriority,
  outboxRetryTimerDelayMs,
} from './useChatOutbox';

export interface EmergencyOutboxDrainTarget {
  protocol: MeshProtocol;
  isSendAvailable: boolean;
  sendFn: ChatOutboxSendFn;
}

export interface UseEmergencyOutboxDrainOptions {
  drains: EmergencyOutboxDrainTarget[];
  /** Test override for deterministic Reticulum receipt timeouts. */
  reticulumReceiptTimeoutMs?: number;
}

export interface ChatOutboxConnectionSnapshot {
  state: { status: string };
  mqttStatus?: string | null;
}

/**
 * Mirrors ChatPanel's outbox availability: operational link (configured/stale) or MQTT
 * connected, except MQTT-only MeshCore (same gate as ChatPanel's `outboxSendAvailable`).
 */
export function isChatOutboxSendAvailable(
  protocol: MeshProtocol,
  view: ChatOutboxConnectionSnapshot,
): boolean {
  const operational = view.state.status === 'configured' || view.state.status === 'stale';
  if (operational) return true;
  return view.mqttStatus === 'connected' && protocol !== 'meshcore';
}

interface TimerHandleRef {
  current: ReturnType<typeof setTimeout> | null;
}

/** (Re)arm one timeout at the earliest per-protocol emergency `nextRetryAt`. */
function scheduleEmergencyRetryTimer(
  timerRef: TimerHandleRef,
  retryAtByProtocol: Map<MeshProtocol, number>,
  drain: (protocol: MeshProtocol) => void,
): void {
  if (timerRef.current != null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  let earliest: number | null = null;
  for (const at of retryAtByProtocol.values()) {
    if (earliest == null || at < earliest) earliest = at;
  }
  if (earliest == null) return;
  const due = earliest;
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    const now = Math.max(Date.now(), due);
    const dueProtocols: MeshProtocol[] = [];
    for (const [protocol, at] of retryAtByProtocol) {
      if (at <= now) dueProtocols.push(protocol);
    }
    for (const protocol of dueProtocols) retryAtByProtocol.delete(protocol);
    // Keep later protocols armed even if a due protocol is currently unavailable.
    scheduleEmergencyRetryTimer(timerRef, retryAtByProtocol, drain);
    for (const protocol of dueProtocols) drain(protocol);
  }, outboxRetryTimerDelayMs(due));
}

/**
 * App-level emergency outbox drain for every protocol, independent of whether ChatPanel is
 * mounted. Only `priority: 'emergency'` rows are sent here; normal rows stay with ChatPanel's
 * `useChatOutbox`. Drains share {@link drainChatOutboxOnce}'s per-protocol lock with ChatPanel so
 * a row is never sent twice. Mount once from App.
 */
export function useEmergencyOutboxDrain({
  drains,
  reticulumReceiptTimeoutMs,
}: UseEmergencyOutboxDrainOptions): void {
  const drainsRef = useRef(drains);
  const retryAtByProtocolRef = useRef(new Map<MeshProtocol, number>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainProtocolRef = useRef<(protocol: MeshProtocol) => Promise<void>>(() =>
    Promise.resolve(),
  );
  useEffect(() => {
    drainsRef.current = drains;
  }, [drains]);

  const scheduleTimer = useCallback(() => {
    scheduleEmergencyRetryTimer(timerRef, retryAtByProtocolRef.current, (protocol) => {
      void drainProtocolRef.current(protocol);
    });
  }, []);

  const drainProtocol = useCallback(
    async (protocol: MeshProtocol) => {
      const target = drainsRef.current.find((d) => d.protocol === protocol);
      if (target?.isSendAvailable !== true) return;
      try {
        const result = await drainChatOutboxOnce({
          protocol,
          sendFn: (text, channel, destination, replyId) => {
            const current = drainsRef.current.find((d) => d.protocol === protocol);
            if (current == null) throw new Error('chatPanel.sendFailed');
            return current.sendFn(text, channel, destination, replyId);
          },
          isSendAvailable: () =>
            drainsRef.current.find((d) => d.protocol === protocol)?.isSendAvailable === true,
          rowFilter: isEmergencyOutboxPriority,
          ...(reticulumReceiptTimeoutMs != null ? { reticulumReceiptTimeoutMs } : {}),
        });
        const at = earliestEmergencyRetryAt(result.rows);
        if (at == null) retryAtByProtocolRef.current.delete(protocol);
        else retryAtByProtocolRef.current.set(protocol, at);
        scheduleTimer();
        if (result.attempted > 0) notifyChatOutboxRowsChanged(protocol);
      } catch (err: unknown) {
        console.warn('[useEmergencyOutboxDrain] drain failed', protocol, err);
      }
    },
    [reticulumReceiptTimeoutMs, scheduleTimer],
  );

  useEffect(() => {
    drainProtocolRef.current = drainProtocol;
  }, [drainProtocol]);

  const protocolsKey = drains.map((d) => d.protocol).join(',');
  useEffect(() => {
    const unsubs = protocolsKey
      .split(',')
      .filter(isMeshProtocol)
      .map((protocol) =>
        registerChatOutboxDrainListener(protocol, () => {
          void drainProtocolRef.current(protocol);
        }),
      );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [protocolsKey]);

  const availabilityKey = drains.map((d) => `${d.protocol}:${d.isSendAvailable ? 1 : 0}`).join(',');
  useEffect(() => {
    for (const d of drainsRef.current) {
      if (d.isSendAvailable) void drainProtocolRef.current(d.protocol);
    }
  }, [availabilityKey]);

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );
}
