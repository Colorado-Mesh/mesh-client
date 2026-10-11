import { MC_RESP_NO_MORE_MESSAGES } from './meshcoreWireCodes';

/** Drop inbound frames that exactly match a recent outbound companion command (TX echo). */
const TX_ECHO_TTL_MS = 500;
const MAX_RECENT_TX = 16;

/**
 * Serial and GATT may reflect SyncNextMessage (0x0A) before the queued frame.
 * Hold that byte briefly: a following longer frame means it was the echo;
 * a quiet hold means it was NoMoreMessages.
 */
export const SYNC_NEXT_MESSAGE_ECHO_HOLD_MS = 150;

function framesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isLoneNoMoreMessages(frame: Uint8Array): boolean {
  return frame.length === 1 && frame[0] === MC_RESP_NO_MORE_MESSAGES;
}

/**
 * Some transports echo the last companion command back on the RX path:
 * - BLE NUS stacks reflect the last RX write on TX notify
 * - USB serial firmware/adapters may return outgoing frames (e.g. CMD DeviceQuery = 22)
 *
 * meshcore.js treats inbound byte[0] as response/push codes. A reflected
 * SyncNextMessage is the same byte as NoMoreMessages, so it is held instead of
 * delivered immediately. TCP does not use this filter.
 */
export class MeshcoreCompanionTxEchoFilter {
  private recent: { frame: Uint8Array; at: number }[] = [];
  private pendingSyncNext = false;
  private heldSyncEcho: Uint8Array | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private deliverHeld: ((frame: Uint8Array) => void) | null = null;

  /** Called by the patch so an expired hold can still reach meshcore.js. */
  setHoldDelivery(deliver: (frame: Uint8Array) => void): void {
    this.deliverHeld = deliver;
  }

  noteOutbound(frame: Uint8Array): void {
    const now = Date.now();
    this.prune(now);
    this.recent.push({ frame: frame.slice(), at: now });
    if (this.recent.length > MAX_RECENT_TX) {
      this.recent.shift();
    }
    if (isLoneNoMoreMessages(frame)) this.pendingSyncNext = true;
  }

  isEcho(inbound: Uint8Array): boolean {
    // SyncNextMessage and NoMoreMessages are both [0x0a]. The hold path owns that byte.
    if (isLoneNoMoreMessages(inbound)) return false;
    const now = Date.now();
    this.prune(now);
    return this.recent.some(({ frame }) => framesEqual(frame, inbound));
  }

  /**
   * Decide what to do with one inbound companion frame.
   * `hold` means the caller must not deliver yet; the filter delivers later.
   */
  ingest(inbound: Uint8Array): 'drop' | 'hold' | 'deliver' {
    if (this.heldSyncEcho) {
      this.clearHold();
      if (inbound.length > 1) {
        // The held 0x0A matched the in-flight SyncNextMessage; this is the real frame.
        return 'deliver';
      }
      if (isLoneNoMoreMessages(inbound)) {
        this.pendingSyncNext = false;
        return 'deliver';
      }
    }

    if (this.pendingSyncNext && isLoneNoMoreMessages(inbound)) {
      this.heldSyncEcho = inbound.slice();
      this.holdTimer = setTimeout(() => {
        const held = this.heldSyncEcho;
        this.heldSyncEcho = null;
        this.holdTimer = null;
        this.pendingSyncNext = false;
        if (held) this.deliverHeld?.(held);
      }, SYNC_NEXT_MESSAGE_ECHO_HOLD_MS);
      return 'hold';
    }

    if (this.isEcho(inbound)) return 'drop';
    return 'deliver';
  }

  private clearHold(): void {
    if (this.holdTimer != null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.heldSyncEcho = null;
  }

  private prune(now: number): void {
    this.recent = this.recent.filter((e) => now - e.at <= TX_ECHO_TTL_MS);
  }
}

export interface MeshcoreEchoFilterableConnection {
  sendToRadioFrame(data: Uint8Array): Promise<void>;
  onFrameReceived(frame: Uint8Array): void;
}

/** Wrap send/onFrameReceived so echoed outbound companion payloads are dropped before meshcore.js. */
export function patchMeshcoreCompanionTxEchoFilter(conn: {
  sendToRadioFrame?: (data: Uint8Array) => Promise<void>;
  onFrameReceived?: (frame: Uint8Array) => void;
}): MeshcoreCompanionTxEchoFilter {
  const filter = new MeshcoreCompanionTxEchoFilter();
  const { sendToRadioFrame, onFrameReceived } = conn;
  if (typeof sendToRadioFrame !== 'function' || typeof onFrameReceived !== 'function') {
    return filter;
  }

  const origSend = sendToRadioFrame.bind(conn);
  const origOnFrame = onFrameReceived.bind(conn);
  filter.setHoldDelivery(origOnFrame);

  conn.sendToRadioFrame = async (data: Uint8Array) => {
    filter.noteOutbound(data);
    await origSend(data);
  };

  conn.onFrameReceived = (frame: Uint8Array) => {
    if (filter.ingest(frame) !== 'deliver') return;
    origOnFrame(frame);
  };

  return filter;
}
