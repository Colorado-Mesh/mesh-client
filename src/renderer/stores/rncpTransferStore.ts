import { create } from 'zustand';

import type { RncpInboundMode, RncpListenerStatus, RncpTransferKind } from '@/shared/remote-types';

/** Default cap for auto-retry attempts after `rncp.failed` on an outbound transfer. */
export const DEFAULT_RNCP_MAX_RETRY_ATTEMPTS = 3;

export type RncpTransferUiStatus = 'active' | 'completed' | 'failed' | 'cancelled';

/** Original send/fetch args — needed to resubmit on manual retry or auto-retry. */
export type RncpRetryArgs = { path: string } | { remote_path: string; save_path?: string };

export interface RncpTransferRecord {
  transfer_id: string;
  kind: RncpTransferKind;
  destination_hash: string;
  file_name: string | null;
  bytes: number | null;
  path: string | null;
  progress: number;
  status: RncpTransferUiStatus;
  error: string | null;
  /** One of `RemoteReasonKey`, kept as `string` for forward compat with unknown sidecar reasons. */
  reason_key: string | null;
  identity_hash: string | null;
  retryCount: number;
  retryArgs?: RncpRetryArgs;
  createdAt: number;
  updatedAt: number;
}

export interface RncpPendingOfferRecord {
  transfer_id: string;
  file_name: string;
  bytes: number;
  identity_hash: string | null;
  receivedAt: number;
}

interface RncpTransferStoreState {
  transfers: Map<string, RncpTransferRecord>;
  pendingOffers: Map<string, RncpPendingOfferRecord>;
  listener: RncpListenerStatus | null;

  startTransfer: (args: {
    transfer_id: string;
    kind: RncpTransferKind;
    destination_hash: string;
    file_name?: string | null;
    retryArgs?: RncpRetryArgs;
    /** Carry retry count across transfer_id churn (sidecar returns a new id each resubmit). */
    retryCount?: number;
  }) => void;
  applyProgress: (transferId: string, progress: number) => void;
  applyCompleted: (payload: {
    transfer_id?: string;
    file_name: string;
    bytes: number;
    path?: string;
    destination_hash?: string;
    identity_hash?: string | null;
  }) => void;
  applyFailed: (payload: {
    transfer_id?: string;
    error?: string;
    reason?: string;
    file_name?: string;
    destination_hash?: string;
    identity_hash?: string | null;
  }) => void;
  applyCancelled: (payload: { transfer_id: string; reason?: string }) => void;
  applyOffer: (payload: {
    transfer_id: string;
    file_name: string;
    bytes: number;
    identity_hash?: string | null;
  }) => void;
  removeOffer: (transferId: string) => void;
  removeTransfer: (transferId: string) => void;
  incrementRetry: (transferId: string) => number;
  setListener: (status: RncpListenerStatus | null) => void;
  setInboundModeOptimistic: (mode: RncpInboundMode) => void;
  clearAll: () => void;
}

function upsertByFileName(
  transfers: Map<string, RncpTransferRecord>,
  fileName: string | undefined,
): RncpTransferRecord | undefined {
  if (!fileName) return undefined;
  for (const t of transfers.values()) {
    if (t.status === 'active' && t.file_name === fileName) return t;
  }
  return undefined;
}

export const useRncpTransferStore = create<RncpTransferStoreState>((set) => ({
  transfers: new Map(),
  pendingOffers: new Map(),
  listener: null,

  startTransfer: ({ transfer_id, kind, destination_hash, file_name, retryArgs, retryCount }) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const now = Date.now();
      const existing = transfers.get(transfer_id);
      transfers.set(transfer_id, {
        transfer_id,
        kind,
        destination_hash: destination_hash.toLowerCase(),
        file_name: file_name ?? existing?.file_name ?? null,
        bytes: existing?.bytes ?? null,
        path: existing?.path ?? null,
        progress: 0,
        status: 'active',
        error: null,
        reason_key: null,
        identity_hash: existing?.identity_hash ?? null,
        retryCount: retryCount ?? existing?.retryCount ?? 0,
        retryArgs: retryArgs ?? existing?.retryArgs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return { transfers };
    });
  },

  applyProgress: (transferId, progress) => {
    set((s) => {
      const existing = s.transfers.get(transferId);
      if (!existing) return {};
      const transfers = new Map(s.transfers);
      transfers.set(transferId, {
        ...existing,
        progress: Math.max(0, Math.min(100, progress)),
        updatedAt: Date.now(),
      });
      return { transfers };
    });
  },

  applyCompleted: (payload) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const now = Date.now();
      const existing = payload.transfer_id
        ? transfers.get(payload.transfer_id)
        : upsertByFileName(transfers, payload.file_name);
      const id = payload.transfer_id ?? existing?.transfer_id ?? `inbound-${now}`;
      transfers.set(id, {
        transfer_id: id,
        kind: existing?.kind ?? 'fetch',
        destination_hash: (
          payload.destination_hash ??
          existing?.destination_hash ??
          ''
        ).toLowerCase(),
        file_name: payload.file_name,
        bytes: payload.bytes,
        path: payload.path ?? existing?.path ?? null,
        progress: 100,
        status: 'completed',
        error: null,
        reason_key: null,
        identity_hash: payload.identity_hash ?? existing?.identity_hash ?? null,
        retryCount: existing?.retryCount ?? 0,
        retryArgs: existing?.retryArgs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      // Ask-mode offers are accepted via rncp.accept then complete — clear the pending offer.
      const pendingOffers = new Map(s.pendingOffers);
      pendingOffers.delete(id);
      return { transfers, pendingOffers };
    });
  },

  applyFailed: (payload) => {
    set((s) => {
      const transfers = new Map(s.transfers);
      const now = Date.now();
      const existing = payload.transfer_id
        ? transfers.get(payload.transfer_id)
        : upsertByFileName(transfers, payload.file_name);
      const id = payload.transfer_id ?? existing?.transfer_id ?? `failed-${now}`;
      transfers.set(id, {
        transfer_id: id,
        kind: existing?.kind ?? 'send',
        destination_hash: (
          payload.destination_hash ??
          existing?.destination_hash ??
          ''
        ).toLowerCase(),
        file_name: payload.file_name ?? existing?.file_name ?? null,
        bytes: existing?.bytes ?? null,
        path: existing?.path ?? null,
        progress: existing?.progress ?? 0,
        status: 'failed',
        error: payload.error ?? null,
        reason_key: payload.reason ?? null,
        identity_hash: payload.identity_hash ?? existing?.identity_hash ?? null,
        retryCount: existing?.retryCount ?? 0,
        retryArgs: existing?.retryArgs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return { transfers };
    });
  },

  applyCancelled: (payload) => {
    set((s) => {
      const existing = s.transfers.get(payload.transfer_id);
      const transfers = new Map(s.transfers);
      const now = Date.now();
      transfers.set(payload.transfer_id, {
        transfer_id: payload.transfer_id,
        kind: existing?.kind ?? 'send',
        destination_hash: existing?.destination_hash ?? '',
        file_name: existing?.file_name ?? null,
        bytes: existing?.bytes ?? null,
        path: existing?.path ?? null,
        progress: existing?.progress ?? 0,
        status: 'cancelled',
        error: null,
        reason_key: payload.reason ?? 'cancelled',
        identity_hash: existing?.identity_hash ?? null,
        retryCount: existing?.retryCount ?? 0,
        retryArgs: existing?.retryArgs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      const pendingOffers = new Map(s.pendingOffers);
      pendingOffers.delete(payload.transfer_id);
      return { transfers, pendingOffers };
    });
  },

  applyOffer: (payload) => {
    set((s) => {
      const pendingOffers = new Map(s.pendingOffers);
      pendingOffers.set(payload.transfer_id, {
        transfer_id: payload.transfer_id,
        file_name: payload.file_name,
        bytes: payload.bytes,
        identity_hash: payload.identity_hash ?? null,
        receivedAt: Date.now(),
      });
      return { pendingOffers };
    });
  },

  removeOffer: (transferId) => {
    set((s) => {
      if (!s.pendingOffers.has(transferId)) return {};
      const pendingOffers = new Map(s.pendingOffers);
      pendingOffers.delete(transferId);
      return { pendingOffers };
    });
  },

  removeTransfer: (transferId) => {
    set((s) => {
      if (!s.transfers.has(transferId)) return {};
      const transfers = new Map(s.transfers);
      transfers.delete(transferId);
      return { transfers };
    });
  },

  incrementRetry: (transferId) => {
    let next = 0;
    set((s) => {
      const existing = s.transfers.get(transferId);
      if (!existing) return {};
      next = existing.retryCount + 1;
      const transfers = new Map(s.transfers);
      transfers.set(transferId, { ...existing, retryCount: next });
      return { transfers };
    });
    return next;
  },

  setListener: (status) => {
    set({ listener: status });
  },

  setInboundModeOptimistic: (mode) => {
    set((s) => {
      if (!s.listener) return {};
      return { listener: { ...s.listener, inbound_mode: mode } };
    });
  },

  clearAll: () => {
    set({ transfers: new Map(), pendingOffers: new Map(), listener: null });
  },
}));
