/**
 * Meshtastic firmware `Channels::generateHash`: for an `encrypted` MeshPacket, the wire
 * `channel` field is NOT the sender's local channel-slot index (that's "meaningless to send
 * between nodes" per the field's own protobuf doc, `@meshtastic/protobufs` mesh_pb.d.ts) — it's
 * an 8-bit XOR fold of the channel name bytes XORed with the XOR fold of the encryption key
 * bytes. Real radios use this (and only this — there's no MQTT topic on RF) to pick which
 * locally-known channel a packet belongs to.
 */

/** XOR-fold every byte down to a single byte (0-255). */
function xorFold(bytes: Uint8Array): number {
  let h = 0;
  for (const b of bytes) h ^= b;
  return h & 0xff;
}

/**
 * Compute the Meshtastic wire channel hash for an encrypted MeshPacket.
 * Pass the same key bytes used to encrypt the packet so hash and cipher stay consistent.
 */
export function computeMeshtasticChannelHash(
  channelName: string,
  psk: Uint8Array | Buffer,
): number {
  const pskBytes = psk instanceof Uint8Array ? psk : new Uint8Array(psk);
  return xorFold(new TextEncoder().encode(channelName)) ^ xorFold(pskBytes);
}
