/**
 * REQ_TYPE_GET_NEIGHBOURS wire format matches @liamcottle/meshcore.js Connection#getNeighbours.
 * That method does not forward an extra timeout to sendBinaryRequest; we build the same payload
 * and call sendBinaryRequest(..., extraTimeoutMillis) from the renderer so multi-hop repeaters
 * can respond within the repeater RPC timeout (see `MESHCORE_REPEATER_RPC_TIMEOUT_MS`).
 *
 * @see https://github.com/meshcore-dev/MeshCore/pull/833
 */

/** Same as meshcore.js Constants.BinaryRequestTypes.GetNeighbours */
export const MESHCORE_BINARY_REQ_GET_NEIGHBOURS = 0x06;

const HEADER_BYTES = 4;
/** prefix + heardSecondsAgo (u32) + snr (i8) */
const NEIGHBOUR_TRAILER_BYTES = 4 + 1;

export class MeshcoreNeighboursParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshcoreNeighboursParseError';
  }
}

export function buildMeshcoreGetNeighboursRequest(params: {
  count: number;
  offset: number;
  orderBy: number;
  pubKeyPrefixLength: number;
}): Uint8Array {
  const buf = new Uint8Array(11);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  buf[o++] = MESHCORE_BINARY_REQ_GET_NEIGHBOURS;
  buf[o++] = 0; // request_version
  buf[o++] = params.count & 0xff;
  const offset = Math.max(0, Math.min(0xffff, Math.floor(params.offset)));
  dv.setUint16(o, offset, true);
  o += 2;
  buf[o++] = params.orderBy & 0xff;
  buf[o++] = params.pubKeyPrefixLength & 0xff;
  const rnd = new Uint8Array(4);
  crypto.getRandomValues(rnd);
  buf.set(rnd, o);
  return buf;
}

export interface MeshcoreParsedNeighbourWire {
  publicKeyPrefix: Uint8Array;
  heardSecondsAgo: number;
  /** Same as meshcore.js: readInt8() / 4 */
  snr: number;
}

export function parseMeshcoreGetNeighboursResponse(
  responseData: Uint8Array,
  pubKeyPrefixLength: number,
): { totalNeighboursCount: number; neighbours: MeshcoreParsedNeighbourWire[] } {
  if (responseData.length < HEADER_BYTES) {
    throw new MeshcoreNeighboursParseError(
      'GetNeighbours response too short for header (' + String(responseData.length) + ' bytes)',
    );
  }
  if (!Number.isFinite(pubKeyPrefixLength) || pubKeyPrefixLength < 1 || pubKeyPrefixLength > 32) {
    throw new MeshcoreNeighboursParseError(
      'GetNeighbours invalid pubKeyPrefixLength=' + String(pubKeyPrefixLength),
    );
  }
  const entrySize = pubKeyPrefixLength + NEIGHBOUR_TRAILER_BYTES;
  const dv = new DataView(responseData.buffer, responseData.byteOffset, responseData.byteLength);
  let o = 0;
  const totalNeighboursCount = dv.getUint16(o, true);
  o += 2;
  const resultsCount = dv.getUint16(o, true);
  o += 2;
  const maxResults = Math.floor((responseData.length - HEADER_BYTES) / entrySize);
  const safeCount = Math.min(resultsCount, Math.max(0, maxResults));
  if (resultsCount > safeCount) {
    throw new MeshcoreNeighboursParseError(
      'GetNeighbours truncated: resultsCount=' +
        String(resultsCount) +
        ' fits=' +
        String(safeCount) +
        ' bytes=' +
        String(responseData.length),
    );
  }
  const neighbours: MeshcoreParsedNeighbourWire[] = [];
  for (let i = 0; i < safeCount; i++) {
    if (o + entrySize > responseData.length) {
      throw new MeshcoreNeighboursParseError(
        'GetNeighbours truncated at entry ' + String(i) + ' of ' + String(safeCount),
      );
    }
    const publicKeyPrefix = responseData.slice(o, o + pubKeyPrefixLength);
    o += pubKeyPrefixLength;
    const heardSecondsAgo = dv.getUint32(o, true);
    o += 4;
    const snrByte = responseData[o];
    o += 1;
    const snrSigned = (snrByte << 24) >> 24;
    const snr = snrSigned / 4;
    neighbours.push({ publicKeyPrefix, heardSecondsAgo, snr });
  }
  return { totalNeighboursCount, neighbours };
}
