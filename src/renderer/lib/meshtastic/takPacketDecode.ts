/**
 * Decodes ATAK plugin payloads into a display summary.
 *
 * Portnum 78 (`ATAK_PLUGIN_V2`) carries `TAKPacketV2`, which flattens the v1
 * contact/group/status/pli nesting and adds CoT enums, weather, sensor FOV,
 * drawn shapes and TAKTALK rooms. Portnum 72 (`ATAK_PLUGIN`) still carries v1.
 */
import { fromBinary } from '@bufbuild/protobuf';
import { ATAK } from '@meshtastic/protobufs';

import { humanizeEnumName } from './protobufEnumOptions';

export interface TakPacketSummary {
  /** Wire format the bytes parsed as. */
  version: 1 | 2;
  callsign?: string;
  /** CoT type: the `cot_type_str` override when present, else the enum name. */
  cotType?: string;
  how?: string;
  team?: string;
  role?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  battery?: number;
  /** Populated oneof branch (`chat`, `shape`, `taktalk`, …), when the packet has one. */
  payloadKind?: string;
  /** Chat body for `chat` / `taktalk` payloads. */
  chatMessage?: string;
  remarks?: string;
  /** Temperature in °C from `TAKEnvironment` (wire units are °C × 10). */
  temperatureC?: number;
  windSpeedMs?: number;
  sensorFovType?: string;
}

const enumName = (
  descriptor: { values: readonly { name: string; number: number }[] },
  value: unknown,
): string | undefined => {
  if (typeof value !== 'number') return undefined;
  return descriptor.values.find((v) => v.number === value)?.name;
};

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** `latitude_i` / `longitude_i` are degrees × 1e7. */
const degrees = (value: unknown): number | undefined => {
  const raw = num(value);
  return raw === undefined || raw === 0 ? undefined : raw / 1e7;
};

function summarizeV2(packet: Record<string, unknown>): TakPacketSummary {
  const environment = packet.environment as Record<string, unknown> | undefined;
  const sensorFov = packet.sensorFov as Record<string, unknown> | undefined;
  const variant = packet.payloadVariant as { case?: string; value?: unknown } | undefined;
  const chat = variant?.case === 'chat' ? (variant.value as Record<string, unknown>) : undefined;
  const taktalk =
    variant?.case === 'taktalk' ? (variant.value as Record<string, unknown>) : undefined;
  const temperatureCX10 = num(environment?.temperatureCX10);
  const windSpeedCmS = num(environment?.windSpeedCmS);

  return {
    version: 2,
    callsign: text(packet.callsign) ?? text(packet.deviceCallsign),
    cotType:
      text(packet.cotTypeStr) ??
      (enumName(ATAK.CotTypeSchema, packet.cotTypeId) !== undefined
        ? humanizeEnumName(String(enumName(ATAK.CotTypeSchema, packet.cotTypeId)))
        : undefined),
    how: enumName(ATAK.CotHowSchema, packet.how),
    team: enumName(ATAK.TeamSchema, packet.team),
    role: enumName(ATAK.MemberRoleSchema, packet.role),
    latitude: degrees(packet.latitudeI),
    longitude: degrees(packet.longitudeI),
    altitude: num(packet.altitude),
    battery: num(packet.battery),
    payloadKind: variant?.case,
    chatMessage: text(chat?.message) ?? text(taktalk?.roomName),
    remarks: text(packet.remarks),
    temperatureC: temperatureCX10 === undefined ? undefined : temperatureCX10 / 10,
    windSpeedMs: windSpeedCmS === undefined ? undefined : windSpeedCmS / 100,
    sensorFovType: enumName(ATAK.SensorFov_SensorTypeSchema, sensorFov?.type),
  };
}

function summarizeV1(packet: Record<string, unknown>): TakPacketSummary {
  const contact = packet.contact as Record<string, unknown> | undefined;
  const group = packet.group as Record<string, unknown> | undefined;
  const status = packet.status as Record<string, unknown> | undefined;
  const variant = packet.payloadVariant as { case?: string; value?: unknown } | undefined;
  const pli = variant?.case === 'pli' ? (variant.value as Record<string, unknown>) : undefined;
  const chat = variant?.case === 'chat' ? (variant.value as Record<string, unknown>) : undefined;

  return {
    version: 1,
    callsign: text(contact?.callsign) ?? text(contact?.deviceCallsign),
    team: enumName(ATAK.TeamSchema, group?.team),
    role: enumName(ATAK.MemberRoleSchema, group?.role),
    latitude: degrees(pli?.latitudeI),
    longitude: degrees(pli?.longitudeI),
    altitude: num(pli?.altitude),
    battery: num(status?.battery),
    payloadKind: variant?.case,
    chatMessage: text(chat?.message),
  };
}

/**
 * Parses ATAK plugin bytes, preferring `TAKPacketV2` and falling back to v1.
 *
 * Both messages are protobufs over the same portnum family, so a v1 payload can
 * still parse as v2 (into meaningless fields); the v2 result is only accepted when
 * it carries at least one recognizable field.
 */
export function decodeTakPacket(bytes: Uint8Array): TakPacketSummary | null {
  if (bytes.length === 0) return null;

  try {
    const v2 = fromBinary(ATAK.TAKPacketV2Schema, bytes) as unknown as Record<string, unknown>;
    const summary = summarizeV2(v2);
    if (
      summary.callsign !== undefined ||
      summary.latitude !== undefined ||
      summary.cotType !== undefined ||
      summary.payloadKind !== undefined
    ) {
      return summary;
    }
  } catch {
    // catch-no-log-ok not a v2 packet; fall through to the v1 attempt
  }

  try {
    const v1 = fromBinary(ATAK.TAKPacketSchema, bytes) as unknown as Record<string, unknown>;
    const summary = summarizeV1(v1);
    if (
      summary.callsign !== undefined ||
      summary.latitude !== undefined ||
      summary.payloadKind !== undefined
    ) {
      return summary;
    }
  } catch {
    // catch-no-log-ok neither wire format matched
  }

  return null;
}
