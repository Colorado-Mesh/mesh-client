/**
 * Channel QR handoff between scanners (launcher / Contacts) and RadioPanel.
 * Radio may be unmounted when the event fires — keep a pending payload until
 * MeshcoreChannelSection / ChannelUrlImportExport mounts and consumes it.
 */

export type ChannelQrSettleOutcome = 'accepted' | 'rejected';
export type ChannelQrOfferOutcome = ChannelQrSettleOutcome | 'deferred' | 'alreadyPending';

export type ChannelQrSettle = (outcome: ChannelQrSettleOutcome) => void;

export interface MeshcoreChannelQrPayload {
  name: string;
  secretHex: string;
  regionScope?: string;
}

export interface PendingMeshcoreChannelQr {
  payload: MeshcoreChannelQrPayload;
}

export interface PendingMeshtasticChannelQr {
  url: string;
}

let pendingMeshcore: PendingMeshcoreChannelQr | null = null;
let pendingMeshtastic: PendingMeshtasticChannelQr | null = null;

/** Offer a MeshCore channel QR to Radio (live listener or pending until mount). */
export function offerMeshcoreChannelQr(
  payload: MeshcoreChannelQrPayload,
): Promise<ChannelQrOfferOutcome> {
  if (pendingMeshcore !== null) {
    return Promise.resolve('alreadyPending');
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle: ChannelQrSettle = (outcome) => {
      if (settled) return;
      settled = true;
      pendingMeshcore = null;
      resolve(outcome);
    };
    pendingMeshcore = { payload };
    window.dispatchEvent(
      new CustomEvent('mesh-client:meshcoreChannelFromQr', {
        detail: { ...payload, settle },
      }),
    );
    // No MeshcoreChannelSection listener this tick → keep pending for Radio mount.
    queueMicrotask(() => {
      if (settled) return;
      settled = true;
      resolve('deferred');
    });
  });
}

/** Take a pending MeshCore channel QR (Radio mount). */
export function takePendingMeshcoreChannelQr(): PendingMeshcoreChannelQr | null {
  const next = pendingMeshcore;
  pendingMeshcore = null;
  return next;
}

/** Offer a Meshtastic channel URL to Radio (live listener or pending until mount). */
export function offerMeshtasticChannelQr(url: string): Promise<ChannelQrOfferOutcome> {
  const trimmed = url.trim();
  return new Promise((resolve) => {
    let settled = false;
    const settle: ChannelQrSettle = (outcome) => {
      if (settled) return;
      settled = true;
      pendingMeshtastic = null;
      resolve(outcome);
    };
    if (!trimmed) {
      settle('rejected');
      return;
    }
    pendingMeshtastic = { url: trimmed };
    window.dispatchEvent(
      new CustomEvent('mesh-client:meshtasticChannelUrl', {
        detail: { url: trimmed, settle },
      }),
    );
    queueMicrotask(() => {
      if (settled) return;
      settled = true;
      resolve('deferred');
    });
  });
}

/** Take a pending Meshtastic channel URL (Radio mount). */
export function takePendingMeshtasticChannelQr(): PendingMeshtasticChannelQr | null {
  const next = pendingMeshtastic;
  pendingMeshtastic = null;
  return next;
}

/** Test helper — clear pending handoffs between cases. */
export function resetQrChannelHandoffForTests(): void {
  pendingMeshcore = null;
  pendingMeshtastic = null;
}
