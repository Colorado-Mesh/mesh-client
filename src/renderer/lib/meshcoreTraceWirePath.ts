/** Companion command code for `CMD_SEND_TRACE_PATH`. */
const MC_CMD_SEND_TRACE_PATH = 36;

/** Bytes of the destination key sent when the whole key is asked for (flags 3). */
const TRACE_LONGEST_ENTRY_BYTES = 8;

export interface MeshcoreTraceWirePath {
  /** Path bytes as the trace command carries them. */
  path: Uint8Array;
  /** Low 2 bits give the entry size: each trace hop is `1 << flags` bytes. */
  flags: number;
  /**
   * Set when 3-byte hop hashes were cut to 2 bytes. The trace reply then carries 2-byte
   * hashes, which must not replace the stored 3-byte path.
   */
  shortenedHops?: true;
}

export interface MeshcoreTraceWirePathOpts {
  /** Size of each hop hash in a stored multi-hop path (path hash mode 1, 2 or 3 bytes). */
  hashSizeBytes: 1 | 2 | 3;
  /** Public key of the node being traced. */
  destPubKey: Uint8Array;
  /**
   * The path is a multi-hop round trip (`[...relays, dest, ...relays reversed]`), so it is
   * always whole hashes and never a single destination entry, even when its bytes happen to
   * match the start of the destination key.
   */
  roundTrip?: boolean;
}

function isPrefixOf(prefix: Uint8Array, whole: Uint8Array): boolean {
  if (prefix.length === 0 || prefix.length > whole.length) return false;
  return prefix.every((byte, i) => byte === whole[i]);
}

/**
 * Turn the app's trace path into what firmware expects on the wire.
 *
 * Firmware (`Mesh::onRecvPacket`, TRACE) reads each hop as `1 << (flags & 3)` bytes: 1, 2, 4
 * or 8, matched against the start of that node's public key. The size is independent of the
 * mesh's path hash mode, and there is no 3-byte entry. Sent with flags 0, a 2-byte hash is
 * read as two 1-byte hops and the full 32-byte key as 32 hops, so the trace never completes.
 *
 * - A path that is a prefix of the destination key is one hop (zero-hop ping): it is sent as
 *   a single entry of the largest size that fits (3 bytes become 2; 5 to 32 become 4 or 8).
 * - A stored multi-hop path keeps its hops: 2-byte hashes are flagged as 2-byte entries, and
 *   3-byte hashes are shortened to their first 2 bytes.
 * - A path that does not divide into whole hashes is sent unchanged as 1-byte entries.
 */
export function meshcoreTraceWirePath(
  path: Uint8Array,
  opts: MeshcoreTraceWirePathOpts,
): MeshcoreTraceWirePath {
  if (!opts.roundTrip && isPrefixOf(path, opts.destPubKey)) {
    if (path.length >= TRACE_LONGEST_ENTRY_BYTES) {
      return { path: path.slice(0, TRACE_LONGEST_ENTRY_BYTES), flags: 3 };
    }
    if (path.length >= 4) {
      return { path: path.slice(0, 4), flags: 2 };
    }
    if (path.length >= 2) {
      return { path: path.slice(0, 2), flags: 1 };
    }
    return { path, flags: 0 };
  }
  if (opts.hashSizeBytes === 2 && path.length % 2 === 0) {
    return { path, flags: 1 };
  }
  if (opts.hashSizeBytes === 3 && path.length % 3 === 0) {
    const shortened = new Uint8Array((path.length / 3) * 2);
    for (let hop = 0; hop * 3 < path.length; hop += 1) {
      shortened.set(path.subarray(hop * 3, hop * 3 + 2), hop * 2);
    }
    return { path: shortened, flags: 1, shortenedHops: true };
  }
  return { path, flags: 0 };
}

/**
 * `CMD_SEND_TRACE_PATH` frame: command, tag (u32 LE), auth (u32 LE), flags, path.
 * meshcore.js `sendCommandSendTracePath` writes flags as 0, so entries above 1 byte need this.
 */
export function buildSendTracePathFrame(
  tag: number,
  auth: number,
  flags: number,
  path: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(10 + path.length);
  const view = new DataView(frame.buffer);
  frame[0] = MC_CMD_SEND_TRACE_PATH;
  view.setUint32(1, tag >>> 0, true);
  view.setUint32(5, auth >>> 0, true);
  frame[9] = flags & 0xff;
  frame.set(path, 10);
  return frame;
}
