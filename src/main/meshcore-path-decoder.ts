const PAYLOAD_TYPE_PATH = 0x08;
const TYPE_MASK = 0x3c;
const TYPE_SHIFT = 2;

export function isPathPacket(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 1) return false;
  return (buffer[0] & TYPE_MASK) >> TYPE_SHIFT === PAYLOAD_TYPE_PATH;
}

export function decodePathPayload(buffer: Buffer): { hops: number; path: number[] } {
  if (buffer.length < 2) throw new Error('Packet too short for PATH header');

  const pathLength = buffer[1] & 0x3f;
  const expectedTotalLength = 2 + pathLength;

  if (buffer.length < expectedTotalLength) {
    throw new Error(
      `Buffer Underrun: path_length is ${pathLength}, but only ${buffer.length - 2} bytes remain.`,
    );
  }

  const path = buffer.subarray(2, expectedTotalLength);

  return {
    hops: pathLength,
    path: Array.from(path),
  };
}
