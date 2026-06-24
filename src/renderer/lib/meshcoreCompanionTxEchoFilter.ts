/** Drop inbound frames that exactly match a recent outbound companion command (TX echo). */
const TX_ECHO_TTL_MS = 500;
const MAX_RECENT_TX = 16;

function framesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Some transports echo the last companion command back on the RX path:
 * - BLE NUS stacks reflect the last RX write on TX notify
 * - USB serial firmware/adapters may return outgoing frames (e.g. CMD DeviceQuery = 22)
 *
 * meshcore.js treats inbound byte[0] as response/push codes; echoed commands log
 * "unhandled frame" even though the real RESP_OK/ERR may follow.
 */
export class MeshcoreCompanionTxEchoFilter {
  private recent: { frame: Uint8Array; at: number }[] = [];

  noteOutbound(frame: Uint8Array): void {
    const now = Date.now();
    this.prune(now);
    this.recent.push({ frame: frame.slice(), at: now });
    if (this.recent.length > MAX_RECENT_TX) {
      this.recent.shift();
    }
  }

  isEcho(inbound: Uint8Array): boolean {
    const now = Date.now();
    this.prune(now);
    return this.recent.some(({ frame }) => framesEqual(frame, inbound));
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

  conn.sendToRadioFrame = async (data: Uint8Array) => {
    filter.noteOutbound(data);
    await origSend(data);
  };

  conn.onFrameReceived = (frame: Uint8Array) => {
    if (filter.isEcho(frame)) return;
    origOnFrame(frame);
  };

  return filter;
}
