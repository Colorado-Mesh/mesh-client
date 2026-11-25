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

/**
 * Incremental line buffer for the plaintext auth phase (before KISS / ExtUDP framing).
 * Returns complete lines (without trailing LF); retains a partial tail.
 */
export class MeshcomAuthLineBuffer {
  private buf = '';

  push(chunk: Uint8Array | string): string[] {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder('utf-8').decode(chunk);
    this.buf += text;
    if (this.buf.length > MESHCOM_AUTH_MAX_LINE_BYTES * 4) {
      this.buf = this.buf.slice(-MESHCOM_AUTH_MAX_LINE_BYTES * 2);
    }
    const lines: string[] = [];
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) break;
      const raw = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (raw.length > MESHCOM_AUTH_MAX_LINE_BYTES) {
        lines.push(raw.slice(0, MESHCOM_AUTH_MAX_LINE_BYTES));
        continue;
      }
      lines.push(raw);
    }
    return lines;
  }

  /** Bytes still buffered (no trailing newline yet). */
  remainder(): string {
    return this.buf;
  }

  clear(): void {
    this.buf = '';
  }
}
