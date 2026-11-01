import { create } from 'zustand';

import type { IdentityId } from '@/renderer/lib/types';

/** One in-flight LXMF file / photo send shown in the DM composer (progress + cancel). */
export interface ReticulumAttachmentTransfer {
  /** Stable UI key (optimistic id, never renamed). */
  id: string;
  identityId: IdentityId;
  /** Chat peer node id for the DM this transfer belongs to. */
  destination: number;
  fileName: string;
  sizeBytes: number;
  /** LXMF message hash once the sidecar accepted the send. */
  messageHash: string | null;
  /** Router outbound progress 0..1; null = unknown (indeterminate bar). */
  progress: number | null;
  cancelling: boolean;
}

interface ReticulumAttachmentSendStoreState {
  transfers: ReticulumAttachmentTransfer[];
  begin: (transfer: ReticulumAttachmentTransfer) => void;
  patch: (id: string, patch: Partial<Omit<ReticulumAttachmentTransfer, 'id'>>) => void;
  end: (id: string) => void;
  reset: () => void;
}

export const useReticulumAttachmentSendStore = create<ReticulumAttachmentSendStoreState>((set) => ({
  transfers: [],
  begin: (transfer) => {
    set((s) => ({ transfers: [...s.transfers.filter((t) => t.id !== transfer.id), transfer] }));
  },
  patch: (id, patch) => {
    set((s) => ({ transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },
  end: (id) => {
    set((s) => {
      const next = s.transfers.filter((t) => t.id !== id);
      return next.length === s.transfers.length ? s : { transfers: next };
    });
  },
  reset: () => {
    set({ transfers: [] });
  },
}));
