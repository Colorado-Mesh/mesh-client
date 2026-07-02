import { md5 } from 'js-md5';

/** MD5 digest as byte array (matches upstream rnode-flasher Utils.md5 on byte arrays). */
export function md5Bytes(data: number[] | Uint8Array): number[] {
  return md5.array(Array.from(data));
}

/** MD5 of a Latin-1 binary string (for esptool-js flash MD5). */
export function md5Latin1String(data: string): string {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    bytes[i] = data.charCodeAt(i) & 0xff;
  }
  return md5.hex(bytes);
}
