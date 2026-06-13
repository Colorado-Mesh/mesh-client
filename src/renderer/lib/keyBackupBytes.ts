/** Shared base64 helpers for encrypted key backup payloads. */

export function keyBackupBytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function keyBackupBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function publicKeyPrefixHex(publicKey: Uint8Array, chars = 8): string {
  return Array.from(publicKey.slice(0, Math.min(4, publicKey.length)))
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, chars);
}

export function nodeNumDisplayHex(nodeNum: number): string {
  return (nodeNum >>> 0).toString(16).toUpperCase();
}
