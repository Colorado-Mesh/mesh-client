const PAYLOAD_TYPE_PATH = 0x08;
const TYPE_MASK = 0x3c;
const TYPE_SHIFT = 2;
const ROUTE_TYPE_MASK = 0x03;
const ROUTE_TYPE_TRANSPORT_FLOOD = 0x00;
const ROUTE_TYPE_TRANSPORT_DIRECT = 0x03;
const TRANSPORT_CODES_SIZE = 4;

export function isPathPacket(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 1) return false;
  return (buffer[0] & TYPE_MASK) >> TYPE_SHIFT === PAYLOAD_TYPE_PATH;
}

export function decodePathPayload(buffer: Buffer): { hops: number; path: number[] } {
  if (buffer.length < 2) throw new Error('Packet too short for PATH header');

  const routeType = buffer[0] & ROUTE_TYPE_MASK;
  const hasTransportCodes =
    routeType === ROUTE_TYPE_TRANSPORT_FLOOD || routeType === ROUTE_TYPE_TRANSPORT_DIRECT;
  const pathLengthOffset = 1 + (hasTransportCodes ? TRANSPORT_CODES_SIZE : 0);

  if (buffer.length < pathLengthOffset + 1) {
    throw new Error(
      `Packet too short: need path_length at offset ${pathLengthOffset}, but buffer is ${buffer.length} bytes`,
    );
  }

  const pathLength = buffer[pathLengthOffset] & 0x3f;
  const hashSizeCode = (buffer[pathLengthOffset] >> 6) & 0x03;
  const hashSize = hashSizeCode + 1;
  const pathByteLength = pathLength * hashSize;
  const pathStartOffset = pathLengthOffset + 1;
  const expectedTotalLength = pathStartOffset + pathByteLength;

  if (buffer.length < expectedTotalLength) {
    throw new Error(
      `Buffer Underrun: path_length is ${pathLength}, hash_size is ${hashSize} (${pathByteLength} bytes), but only ${buffer.length - pathStartOffset} bytes remain.`,
    );
  }

  const path = buffer.subarray(pathStartOffset, expectedTotalLength);

  return {
    hops: pathLength,
    path: Array.from(path),
  };
}
