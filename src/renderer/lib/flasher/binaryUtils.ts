/** Binary helpers ported from liamcottle/rnode-flasher Utils. */

export function sleepMillis(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis);
  });
}

export function bytesToHex(bytes: number[] | Uint8Array): string {
  const hex: string[] = [];
  for (const byte of bytes) {
    const current = byte < 0 ? byte + 256 : byte;
    hex.push((current >>> 4).toString(16));
    hex.push((current & 0xf).toString(16));
  }
  return hex.join('');
}

export function packUInt32BE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value >>> 0, false);
  return new Uint8Array(buffer);
}

export function unpackUInt32BE(byteArray: number[] | Uint8Array): number {
  const buffer = new Uint8Array(byteArray).buffer;
  const view = new DataView(buffer);
  return view.getUint32(0, false);
}

/** Parse flash map keys from firmware configs (`0x10000` hex or decimal). */
export function parseFlashAddress(address: string): number {
  const trimmed = address.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return parseInt(trimmed, 16);
  }
  return parseInt(trimmed, 10);
}

export async function blobToBinaryString(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let result = '';
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}
