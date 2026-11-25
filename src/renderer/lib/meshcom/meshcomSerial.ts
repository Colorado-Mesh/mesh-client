/**
 * MeshCom USB serial console helpers (115200).
 * Commands are `--`-prefixed; chat inject uses `{CALL}text` or plain lines.
 */

import { normalizeMeshcomCallsign } from './meshcomCallsign';
import { meshcomBodyBudgetBytes, truncateToWireBytes } from './meshcomWireLimits';
import { sanitizeMeshcomWireLine } from './meshcomWireSanitize';

/** Max buffered serial console bytes before reset (DoS guard). */
const MESHCOM_SERIAL_LINE_BUFFER_MAX = 128 * 1024;

/** Build a console line (CRLF terminated). */
export function encodeMeshcomSerialLine(command: string): Uint8Array {
  const safe = sanitizeMeshcomWireLine(command);
  const line = safe.endsWith('\n') ? safe : `${safe}\r\n`;
  return new TextEncoder().encode(line);
}

/** Outbound chat over serial: `{DST}text` for directed, plain text for ALL. */
export function meshcomSerialSendText(dst: string, text: string): Uint8Array {
  const dest = dst.trim();
  const body = truncateToWireBytes(text, meshcomBodyBudgetBytes(dest));
  if (!dest || dest === '*') {
    return encodeMeshcomSerialLine(body);
  }
  if (/^\d+$/.test(dest)) {
    return encodeMeshcomSerialLine(`{${dest}}${body}`);
  }
  const call = normalizeMeshcomCallsign(dest);
  return encodeMeshcomSerialLine(`{${call}}${body}`);
}

/**
 * NET Console interactive TX (`::` prefix — gomeshcom / firmware ExtUDP console).
 * Same address+body UTF-8 budget as serial.
 */
export function meshcomNetConsoleSendText(dst: string, text: string): Uint8Array {
  const dest = dst.trim();
  const body = truncateToWireBytes(text, meshcomBodyBudgetBytes(dest));
  if (!dest || dest === '*') {
    return encodeMeshcomSerialLine(`::${body}`);
  }
  if (/^\d+$/.test(dest)) {
    return encodeMeshcomSerialLine(`::{${dest}}${body}`);
  }
  const call = normalizeMeshcomCallsign(dest);
  return encodeMeshcomSerialLine(`::{${call}}${body}`);
}

/**
 * Streaming line splitter for serial console RX.
 */
export class MeshcomSerialLineBuffer {
  private buf = '';

  push(chunk: Uint8Array | string): string[] {
    if (this.buf.length > MESHCOM_SERIAL_LINE_BUFFER_MAX) {
      this.reset();
    }
    const text =
      typeof chunk === 'string' ? chunk : new TextDecoder('utf-8', { fatal: false }).decode(chunk);
    this.buf += text;
    if (this.buf.length > MESHCOM_SERIAL_LINE_BUFFER_MAX) {
      this.reset();
      return [];
    }
    const lines: string[] = [];
    for (;;) {
      const idx = this.buf.search(/\r\n|\n|\r/);
      if (idx < 0) break;
      const line = this.buf.slice(0, idx);
      const nl = this.buf[idx] === '\r' && this.buf[idx + 1] === '\n' ? 2 : 1;
      this.buf = this.buf.slice(idx + nl);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  reset(): void {
    this.buf = '';
  }
}
