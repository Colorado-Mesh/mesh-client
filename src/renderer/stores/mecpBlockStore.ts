import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { isMeshProtocol, type MeshProtocol } from '@/shared/meshProtocol';

/** One sender whose MECP reports no longer alert, open incidents, or get rebroadcast. */
export interface MecpBlockedSender {
  protocol: MeshProtocol;
  /** Same `String(msg.from)` id the incident store keys senders by. */
  senderId: string;
  label: string;
  createdAt: number;
}

/** Oldest entries drop past this so a long spam campaign cannot grow localStorage unbounded. */
export const MAX_MECP_BLOCKED_SENDERS = 500;

export function mecpBlockKey(protocol: MeshProtocol, senderId: string): string {
  return `${protocol}:${senderId}`;
}

/** Drop malformed persisted rows (hand-edited or older shapes) so lookups and the list stay sound. */
function sanitizeBlocked(raw: unknown): Record<string, MecpBlockedSender> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, MecpBlockedSender> = {};
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    const { protocol, senderId, label, createdAt } = e;
    if (typeof protocol !== 'string' || !isMeshProtocol(protocol)) continue;
    if (typeof senderId !== 'string' || senderId === '') continue;
    out[mecpBlockKey(protocol, senderId)] = {
      protocol,
      senderId,
      label: typeof label === 'string' && label !== '' ? label : senderId,
      createdAt: typeof createdAt === 'number' ? createdAt : 0,
    };
  }
  return out;
}

interface MecpBlockState {
  blocked: Record<string, MecpBlockedSender>;
  block: (protocol: MeshProtocol, senderId: string, label?: string) => void;
  unblock: (protocol: MeshProtocol, senderId: string) => void;
}

export const useMecpBlockStore = create<MecpBlockState>()(
  persist(
    (set) => ({
      blocked: {},
      block: (protocol, senderId, label) =>
        set((s) => {
          const key = mecpBlockKey(protocol, senderId);
          if (s.blocked[key]) return s;
          const entry: MecpBlockedSender = {
            protocol,
            senderId,
            label: label?.trim() || senderId,
            createdAt: Date.now(),
          };
          const entries = [...Object.values(s.blocked), entry]
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(-MAX_MECP_BLOCKED_SENDERS);
          return {
            blocked: Object.fromEntries(
              entries.map((e) => [mecpBlockKey(e.protocol, e.senderId), e]),
            ),
          };
        }),
      unblock: (protocol, senderId) =>
        set((s) => {
          const key = mecpBlockKey(protocol, senderId);
          if (!s.blocked[key]) return s;
          return {
            blocked: Object.fromEntries(Object.entries(s.blocked).filter(([k]) => k !== key)),
          };
        }),
    }),
    {
      name: 'mesh-client:mecpBlockedSenders',
      version: 1,
      partialize: (s) => ({ blocked: s.blocked }),
      merge: (persisted, current) => ({
        ...current,
        blocked: sanitizeBlocked((persisted as { blocked?: unknown } | undefined)?.blocked),
      }),
    },
  ),
);

/** Non-React lookup for the watcher / ChatPanel alert paths. */
export function isMecpSenderBlocked(protocol: MeshProtocol, senderId: string): boolean {
  return Object.hasOwn(useMecpBlockStore.getState().blocked, mecpBlockKey(protocol, senderId));
}
