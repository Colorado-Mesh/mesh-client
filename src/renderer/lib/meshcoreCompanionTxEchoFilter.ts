/** Drop inbound BLE frames that exactly match a recent outbound companion command (TX echo). */
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
 * Some BLE stacks (or firmware) reflect the last NUS RX write on the TX notify characteristic.
 * meshcore.js treats any inbound byte[0] as a response/push code; echoed commands (e.g. 25 =
 * CMD_SEND_RAW_DATA) log "unhandled frame" even though the real RESP_OK/ERR may follow.
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
