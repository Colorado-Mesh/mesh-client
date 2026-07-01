import { downloadBlob } from '../downloadBlob';

/** Save Nomad Network file bytes (base64 from sidecar) via a one-shot browser download. */
export function downloadNomadFileFromBase64(fileName: string, contentBase64: string): void {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  downloadBlob(new Blob([bytes]), fileName);
}
