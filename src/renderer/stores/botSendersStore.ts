import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { MeshProtocol } from '../lib/types';

export const BOT_SENDERS_STORAGE_KEY = 'mesh-client:botSenders';
/** Per-protocol cap; the oldest detections are evicted first (Sets keep insertion order). */
export const BOT_SENDERS_MAX_PER_PROTOCOL = 500;

const PROTOCOLS: readonly MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum'];

type BotSenderSets = Readonly<Record<MeshProtocol, ReadonlySet<number>>>;

interface BotSendersState {
  /**
   * Sender ids whose messages matched a known bot reply template. MeshCore channel senders
   * are name-hash stub ids, so a bot that renames itself loses its badge until it replies again.
   */
  senders: BotSenderSets;
  markBotSender: (protocol: MeshProtocol, senderId: number) => void;
  clearBotSender: (protocol: MeshProtocol, senderId: number) => void;
}

function emptySenders(): Record<MeshProtocol, ReadonlySet<number>> {
  return { meshtastic: new Set(), meshcore: new Set(), reticulum: new Set() };
}

export const useBotSendersStore = create<BotSendersState>()(
  persist(
    (set) => ({
      senders: emptySenders(),
      markBotSender: (protocol, senderId) => {
        if (!Number.isFinite(senderId) || senderId <= 0) return;
        set((state) => {
          const current = state.senders[protocol];
          if (current.has(senderId)) return state;
          const next = new Set(current);
          next.add(senderId);
          while (next.size > BOT_SENDERS_MAX_PER_PROTOCOL) {
            const oldest = next.values().next();
            if (oldest.done) break;
            next.delete(oldest.value);
          }
          return { senders: { ...state.senders, [protocol]: next } };
        });
      },
      clearBotSender: (protocol, senderId) => {
        set((state) => {
          const current = state.senders[protocol];
          if (!current.has(senderId)) return state;
          const next = new Set(current);
          next.delete(senderId);
          return { senders: { ...state.senders, [protocol]: next } };
        });
      },
    }),
    {
      name: BOT_SENDERS_STORAGE_KEY,
      partialize: (state) => ({ senders: state.senders }),
      storage: {
        getItem: (key) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as {
              state?: { senders?: Partial<Record<MeshProtocol, unknown>> };
              version?: number;
            };
            const senders = emptySenders();
            for (const protocol of PROTOCOLS) {
              const ids = parsed.state?.senders?.[protocol];
              if (Array.isArray(ids)) {
                senders[protocol] = new Set(
                  ids
                    .filter((id): id is number => typeof id === 'number' && id > 0)
                    .slice(-BOT_SENDERS_MAX_PER_PROTOCOL),
                );
              }
            }
            return { state: { senders }, version: parsed.version ?? 0 };
          } catch {
            // catch-no-log-ok: invalid persisted data, fall back to defaults
          }
          return null;
        },
        setItem: (key, value) => {
          const senders: Record<string, number[]> = {};
          for (const protocol of PROTOCOLS) {
            senders[protocol] = [...value.state.senders[protocol]];
          }
          localStorage.setItem(key, JSON.stringify({ ...value, state: { senders } }));
        },
        removeItem: (key) => {
          localStorage.removeItem(key);
        },
      },
    },
  ),
);

/** Per-id selector so only components showing this sender re-render. */
export function useIsBotSender(
  protocol: MeshProtocol,
  senderId: number | null | undefined,
): boolean {
  return useBotSendersStore((s) => senderId != null && s.senders[protocol].has(senderId));
}
