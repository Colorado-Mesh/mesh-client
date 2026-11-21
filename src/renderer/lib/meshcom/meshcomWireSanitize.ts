/**
 * Strip C0 control characters (incl. CR/LF) from MeshCom wire text before serial/BLE encode.
 * Prevents console command injection when chat or UI fields embed newlines.
 */

/** Remove control chars; keep tab for rare multi-word args. */
export function stripMeshcomWireControls(text: string, opts?: { allowTab?: boolean }): string {
  const allowTab = opts?.allowTab === true;
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0x09 && allowTab) {
      out += ch;
      continue;
    }
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

/** Sanitize a full line destined for serial CRLF or BLE command framing. */
export function sanitizeMeshcomWireLine(line: string): string {
  return stripMeshcomWireControls(line).trim();
}

/** True when the raw user text contains characters stripped by {@link stripMeshcomWireControls}. */
export function meshcomWireHadControlChars(text: string): boolean {
  return stripMeshcomWireControls(text) !== text.replace(/\u007f/g, '');
}
