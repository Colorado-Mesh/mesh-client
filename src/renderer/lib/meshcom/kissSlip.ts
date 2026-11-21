/**
 * KISS SLIP framing (FEND/FESC) for MeshCom TCP :8001.
 * Pattern mirrors RNode helpers without importing the flasher RNode class.
 */

export const KISS_FEND = 0xc0;
export const KISS_FESC = 0xdb;
export const KISS_TFEND = 0xdc;
export const KISS_TFESC = 0xdd;

/**
 * Max encoded bytes buffered between FENDs. Delimiter-free TCP streams must not
 * grow the deframer without bound (DoS).
 */
export const KISS_SLIP_DEFRAME_MAX_BYTES = 128 * 1024;

/** @deprecated Prefer {@link KISS_SLIP_DEFRAME_MAX_BYTES}. */
export const KISS_SLIP_MAX_ENCODED_FRAME_BYTES = KISS_SLIP_DEFRAME_MAX_BYTES;

/** Escape payload bytes and wrap with FEND delimiters (includes type byte in payload). */
export function kissSlipEncode(payload: Uint8Array | number[]): Uint8Array {
  const out: number[] = [KISS_FEND];
  for (const byte of payload) {
    if (byte === KISS_FEND) {
      out.push(KISS_FESC, KISS_TFEND);
    } else if (byte === KISS_FESC) {
      out.push(KISS_FESC, KISS_TFESC);
    } else {
      out.push(byte);
    }
  }
  out.push(KISS_FEND);
  return new Uint8Array(out);
}

/**
 * Unescape a single KISS frame body (bytes between FENDs).
 * Returns null when the escape sequence is incomplete or invalid.
 */
export function kissSlipDecode(frame: Uint8Array | number[]): Uint8Array | null {
  const data: number[] = [];
  let escaping = false;

  for (const byte of frame) {
    if (escaping) {
      if (byte === KISS_TFEND) {
        data.push(KISS_FEND);
      } else if (byte === KISS_TFESC) {
        data.push(KISS_FESC);
      } else {
        return null;
      }
      escaping = false;
    } else if (byte === KISS_FESC) {
      escaping = true;
    } else {
      data.push(byte);
    }
  }

  return escaping ? null : new Uint8Array(data);
}

/**
 * Streaming deframer: feed TCP chunks, receive complete deslipped frames
 * (type byte + payload). Empty / consecutive FENDs are ignored (MeshCom §2).
 */
export class KissSlipDeframer {
  private buffer: number[] = [];
  /** After overflow, drop bytes until the next FEND (no partial frame emit). */
  private dropUntilFend = false;

  push(chunk: Uint8Array | number[]): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (const byte of chunk) {
      if (byte === KISS_FEND) {
        if (this.dropUntilFend) {
          this.dropUntilFend = false;
          this.buffer = [];
          continue;
        }
        if (this.buffer.length > 0) {
          const decoded = kissSlipDecode(this.buffer);
          if (decoded && decoded.length > 0) {
            frames.push(decoded);
          }
          this.buffer = [];
        }
      } else if (this.dropUntilFend) {
        // Discard until the next FEND so a partial over-limit frame cannot resume.
        continue;
      } else {
        this.buffer.push(byte);
        if (this.buffer.length > KISS_SLIP_DEFRAME_MAX_BYTES) {
          this.buffer = [];
          this.dropUntilFend = true;
        }
      }
    }
    return frames;
  }

  reset(): void {
    this.buffer = [];
    this.dropUntilFend = false;
  }
}
