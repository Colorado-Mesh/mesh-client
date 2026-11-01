/**
 * Cayenne Low Power Payload (LPP) decoder for Meshtastic `CAYENNE_APP` (portnum 77).
 *
 * Wire format: repeating `[channel:u8][type:u8][data…]` records. Type IDs and scales follow the
 * Cayenne LPP 1.0 reserved list plus the widely deployed extended types (percentage, power,
 * distance, energy, direction, unix time, switch).
 *
 * Protocol exception: Meshtastic only (firmware transports the payload on CAYENNE_APP).
 *
 * Failure point: a record with an unknown type has unknown length, so decoding stops there and
 * returns the readings parsed so far with `truncated: true`; a record whose data runs past the end
 * of the buffer is dropped the same way. Nothing throws on malformed bytes.
 */

export type CayenneKind =
  | 'digitalInput'
  | 'digitalOutput'
  | 'analogInput'
  | 'analogOutput'
  | 'illuminance'
  | 'presence'
  | 'temperature'
  | 'humidity'
  | 'accelerometer'
  | 'barometer'
  | 'gyrometer'
  | 'gps'
  | 'percentage'
  | 'concentration'
  | 'power'
  | 'distance'
  | 'energy'
  | 'direction'
  | 'unixTime'
  | 'switch';

export interface CayenneReading {
  channel: number;
  typeId: number;
  kind: CayenneKind;
  /** Named numeric fields: `value` for scalars, `x`/`y`/`z` for vectors, `lat`/`lon`/`alt` for GPS. */
  values: Record<string, number>;
  /** Unit string for display (technical symbol, not localized prose); '' when unitless. */
  unit: string;
}

export interface CayenneDecodeResult {
  readings: CayenneReading[];
  /** True when decoding stopped early (unknown type or short record). */
  truncated: boolean;
}

type FieldNames = readonly string[];

interface CayenneTypeSpec {
  kind: CayenneKind;
  /** Bytes of data after the 2-byte header. */
  size: number;
  unit: string;
  decode: (view: DataView) => Record<string, number>;
}

function i24(view: DataView, offset: number): number {
  const raw =
    (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
  return raw & 0x800000 ? raw - 0x1000000 : raw;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function scalar(
  kind: CayenneKind,
  size: number,
  unit: string,
  read: (view: DataView) => number,
): CayenneTypeSpec {
  return { kind, size, unit, decode: (v) => ({ value: read(v) }) };
}

function vec3(kind: CayenneKind, unit: string, scale: number): CayenneTypeSpec {
  const names: FieldNames = ['x', 'y', 'z'];
  return {
    kind,
    size: 6,
    unit,
    decode: (v) =>
      Object.fromEntries(names.map((n, i) => [n, round(v.getInt16(i * 2, false) / scale, 3)])),
  };
}

const TYPES: ReadonlyMap<number, CayenneTypeSpec> = new Map<number, CayenneTypeSpec>([
  [0, scalar('digitalInput', 1, '', (v) => v.getUint8(0))],
  [1, scalar('digitalOutput', 1, '', (v) => v.getUint8(0))],
  [2, scalar('analogInput', 2, '', (v) => round(v.getInt16(0, false) / 100, 2))],
  [3, scalar('analogOutput', 2, '', (v) => round(v.getInt16(0, false) / 100, 2))],
  [101, scalar('illuminance', 2, 'lx', (v) => v.getUint16(0, false))],
  [102, scalar('presence', 1, '', (v) => v.getUint8(0))],
  [103, scalar('temperature', 2, '°C', (v) => round(v.getInt16(0, false) / 10, 1))],
  [104, scalar('humidity', 1, '%', (v) => round(v.getUint8(0) / 2, 1))],
  [113, vec3('accelerometer', 'G', 1000)],
  [115, scalar('barometer', 2, 'hPa', (v) => round(v.getUint16(0, false) / 10, 1))],
  [120, scalar('percentage', 1, '%', (v) => v.getUint8(0))],
  [125, scalar('concentration', 2, 'ppm', (v) => v.getUint16(0, false))],
  [128, scalar('power', 2, 'W', (v) => v.getUint16(0, false))],
  [130, scalar('distance', 4, 'm', (v) => round(v.getUint32(0, false) / 1000, 3))],
  [131, scalar('energy', 4, 'kWh', (v) => round(v.getUint32(0, false) / 1000, 3))],
  [132, scalar('direction', 2, '°', (v) => v.getUint16(0, false))],
  [133, scalar('unixTime', 4, '', (v) => v.getUint32(0, false))],
  [134, vec3('gyrometer', '°/s', 100)],
  [
    136,
    {
      kind: 'gps',
      size: 9,
      unit: '',
      decode: (v) => ({
        lat: round(i24(v, 0) / 10000, 4),
        lon: round(i24(v, 3) / 10000, 4),
        alt: round(i24(v, 6) / 100, 2),
      }),
    },
  ],
  [142, scalar('switch', 1, '', (v) => v.getUint8(0))],
]);

/** Decode a Cayenne LPP buffer. Never throws. */
export function decodeCayenneLpp(bytes: Uint8Array): CayenneDecodeResult {
  const readings: CayenneReading[] = [];
  let offset = 0;
  let truncated = false;
  while (offset < bytes.length) {
    // A lone trailing byte, or a record header only, is garbage.
    if (offset + 2 > bytes.length) {
      truncated = true;
      break;
    }
    const channel = bytes[offset] ?? 0;
    const typeId = bytes[offset + 1] ?? 0;
    const spec = TYPES.get(typeId);
    if (!spec || offset + 2 + spec.size > bytes.length) {
      truncated = true;
      break;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 2, spec.size);
    readings.push({ channel, typeId, kind: spec.kind, values: spec.decode(view), unit: spec.unit });
    offset += 2 + spec.size;
  }
  return { readings, truncated };
}

/** Stable series key for charting: `kind#channel` or `kind#channel.field` for vector readings. */
export function cayenneSeriesKey(reading: CayenneReading, field: string): string {
  return field === 'value'
    ? `${reading.kind}#${reading.channel}`
    : `${reading.kind}#${reading.channel}.${field}`;
}
