export type LiveTrafficControlSubtype = 'DISCOVER_REQ' | 'DISCOVER_RESP';

/** The first control payload byte identifies its purpose, even if later fields are absent. */
export function liveTrafficControlSubtype(
  kind: string,
  decoded: unknown,
  rawPayload?: unknown,
): LiveTrafficControlSubtype | undefined {
  if (kind !== 'CONTROL') return undefined;
  if (rawPayload != null) {
    let firstByte: number;
    if (rawPayload instanceof Uint8Array && rawPayload.length > 0) firstByte = rawPayload[0];
    else if (
      typeof rawPayload === 'string' &&
      rawPayload.length >= 2 &&
      rawPayload.length <= 65_536 &&
      rawPayload.length % 2 === 0 &&
      /^[a-f\d]+$/i.test(rawPayload)
    )
      firstByte = Number.parseInt(rawPayload.slice(0, 2), 16);
    else return undefined;
    // Prefer the captured discriminator over decoded metadata if they disagree.
    switch (firstByte & 0xf0) {
      case 0x80:
        return 'DISCOVER_REQ';
      case 0x90:
        return 'DISCOVER_RESP';
      default:
        return undefined;
    }
  }
  const subtype = typeof decoded === 'string' ? decoded.toUpperCase() : null;
  return subtype === 'DISCOVER_REQ' || subtype === 'DISCOVER_RESP' ? subtype : undefined;
}
