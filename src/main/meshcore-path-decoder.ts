import type { Buffer } from 'node:buffer';

import {
  decodeMeshCorePathPrefix,
  isMeshCorePathPacketByte0,
  isMeshCoreTracePacketByte0,
} from '../shared/meshcoreRfPath';

export function isPathPacket(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 1) return false;
  return isMeshCorePathPacketByte0(buffer[0]);
}

export function isTracePacket(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 1) return false;
  return isMeshCoreTracePacketByte0(buffer[0]);
}

export function decodePathPayload(buffer: Buffer): { hops: number; path: number[] } {
  const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const { hops, path } = decodeMeshCorePathPrefix(u8);
  return { hops, path };
}

export function decodeTracePayload(buffer: Buffer): { hops: number; path: number[] } {
  return decodePathPayload(buffer);
}
