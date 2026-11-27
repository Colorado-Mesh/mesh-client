/**
 * MeshCom NET Console / KISS TCP challenge-response (HMAC-SHA256).
 * Same wire as ICSSW NET Console and MeshcomWebDesk `--kiss auth`.
 */

/** Wait for a greeting before assuming auth is disabled. */
export const MESHCOM_AUTH_GREETING_TIMEOUT_MS = 3_000;

/** Max line length accepted during the auth handshake. */
export const MESHCOM_AUTH_MAX_LINE_BYTES = 128;

const NONCE_RE = /^NONCE:\s*([0-9a-fA-F]{32})\s*$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

export type MeshcomAuthGreeting =
  | { kind: 'ok' }
  | { kind: 'fail' }
  | { kind: 'nonce'; nonceHex: string }
  | { kind: 'unknown'; line: string };

/** One complete auth line plus the raw bytes including the trailing LF. */
export interface MeshcomAuthBufferedLine {
  text: string;
  /** Line bytes including the terminating `0x0a` (no re-encode needed for leftover). */
  rawWithNl: Uint8Array;
}

/** Parse a single auth greeting line (CRLF stripped). */
export function parseMeshcomAuthGreeting(line: string): MeshcomAuthGreeting {
  const trimmed = line.replace(/\r$/, '').trim();
  if (trimmed === 'OK') return { kind: 'ok' };
  if (trimmed === 'FAIL') return { kind: 'fail' };
  const m = NONCE_RE.exec(trimmed);
  if (m?.[1]) return { kind: 'nonce', nonceHex: m[1].toLowerCase() };
  return { kind: 'unknown', line: trimmed };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (const b of u8) {
    s += b.toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * HMAC-SHA256(password as UTF-8, nonce as raw 16 bytes) → 64 lowercase hex.
 * Firmware / WebDesk use the hex-decoded nonce as the HMAC message
 * (`hmac.new(password, bytes.fromhex(nonce), sha256)`).
 */
export async function meshcomAuthHmacHex(password: string, nonceHex: string): Promise<string> {
  const normalized = nonceHex.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    throw new Error('MeshCom auth nonce must be 32 hex characters');
  }
  // Copy into a fresh ArrayBuffer so Web Crypto's BufferSource typing accepts the view
  // (Uint8Array<ArrayBufferLike> is rejected under strict DOM lib generics).
  const keyBuf = Uint8Array.from(new TextEncoder().encode(password)).buffer;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const nonceBuf = Uint8Array.from(hexToBytes(normalized)).buffer;
  const sig = await crypto.subtle.sign('HMAC', key, nonceBuf);
  return bytesToHex(sig);
}

/** True when `hex` is a 64-char lowercase HMAC response. */
export function isMeshcomAuthHmacResponse(hex: string): boolean {
  return HEX64_RE.test(hex.trim().toLowerCase());
}

function concatUint8(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  if (total === 0) return new Uint8Array(0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Incremental line buffer for the plaintext auth phase (before KISS / ExtUDP framing).
 * Works on raw bytes so leftovers after `OK` can be forwarded without re-encoding.
 */
export class MeshcomAuthLineBuffer {
  private buf = new Uint8Array(0);
  private readonly decoder = new TextDecoder('utf-8');

  push(chunk: Uint8Array | string): MeshcomAuthBufferedLine[] {
    const add = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    if (add.length === 0) return [];
    const merged = new Uint8Array(this.buf.length + add.length);
    merged.set(this.buf);
    merged.set(add, this.buf.length);
    this.buf = merged;

    const lines: MeshcomAuthBufferedLine[] = [];
    let sawOk = false;
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) break;
      const rawLine = this.buf.subarray(0, nl);
      // Discard oversized auth lines in full — never emit a truncated greeting prefix.
      // The loop stops at OK, so this cap never applies to the KISS/NET Console tail.
      if (rawLine.length > MESHCOM_AUTH_MAX_LINE_BYTES) {
        this.buf = this.buf.subarray(nl + 1);
        continue;
      }
      const rawWithNl = this.buf.subarray(0, nl + 1);
      const text = this.decoder.decode(rawLine);
      this.buf = this.buf.subarray(nl + 1);
      lines.push({ text, rawWithNl: rawWithNl.slice() });
      if (parseMeshcomAuthGreeting(text).kind === 'ok') {
        sawOk = true;
        break;
      }
    }
    // Limit only the unfinished auth line; drop it entirely if already oversized so a
    // later `\n` cannot turn a suffix into a valid greeting. Post-OK bytes stay raw.
    if (!sawOk && this.buf.length > MESHCOM_AUTH_MAX_LINE_BYTES) {
      this.buf = new Uint8Array(0);
    }
    return lines;
  }

  /** Unfinished bytes still buffered (no trailing LF). Clears the buffer. */
  takeRemainder(): Uint8Array {
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }

  /** Bytes still buffered (no trailing newline yet). */
  remainder(): string {
    return this.decoder.decode(this.buf);
  }
}

/** Concatenate leftover line bytes + unfinished tail into one raw chunk. */
export function concatMeshcomAuthLeftover(parts: readonly Uint8Array[]): Uint8Array {
  return concatUint8(parts);
}
