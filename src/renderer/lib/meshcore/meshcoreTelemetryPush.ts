/**
 * Telemetry push subscriptions to MeshCore sensor nodes (firmware v1.18).
 *
 * Wire (binary request body after the companion-added timestamp):
 *   subscribe   `[0x08, tag u32 LE, timeoutSecs u16 LE, reserved u8, minDeltasLen u8, minDeltas…]`
 *   unsubscribe `[0x09]`
 * The sensor accepts 3..14 bytes of min-deltas and replies `[grantedSecs u16 LE, reserved u16, scope…]`
 * (granted 0 = rejected). It then pushes `[tag u32, timestamp u32, Cayenne LPP…]` whenever a watched
 * value moved more than its delta; the companion forwards that as an unsolicited
 * PUSH_CODE_BINARY_RESPONSE (0x8C) with no sender key, so the tag is the only routing key.
 * @see meshcore-dev/MeshCore examples/simple_sensor/SensorMesh.cpp (REQ_TYPE_SUBSCRIBE, telemHasChanged)
 * @see meshcore-dev/MeshCore src/helpers/sensors/LPPDataHelpers.h (getDataSize, getMultiplier)
 */

export const MESHCORE_REQ_TYPE_TELEMETRY_SUBSCRIBE = 0x08;
export const MESHCORE_REQ_TYPE_TELEMETRY_UNSUBSCRIBE = 0x09;

/** `ClientInfo.extra.sensor.min_deltas[14]` on the sensor. */
export const MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MAX_BYTES = 14;
/** Firmware ignores min-delta blocks shorter than one entry (channel, type, 1-byte value). */
export const MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MIN_BYTES = 3;
export const MESHCORE_TELEMETRY_PUSH_MAX_TIMEOUT_SECS = 0xffff;
export const MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS = 60;
/** Re-subscribe this far into the granted window so pushes never lapse. */
export const MESHCORE_TELEMETRY_PUSH_RESUBSCRIBE_FRACTION = 0.8;

export type MeshcoreTelemetryPushMetric = 'temperature' | 'humidity' | 'pressure' | 'voltage';

export type MeshcoreTelemetryPushThresholds = Partial<Record<MeshcoreTelemetryPushMetric, number>>;

interface LppMinDeltaCodec {
  lppType: number;
  /** Byte size and multiplier from `LPPData::getDataSize` / `getMultiplier` (not the wire LPP size). */
  size: number;
  multiplier: number;
  signed: boolean;
}

/** Order also sets priority when the 14-byte limit forces a cut. */
export const MESHCORE_TELEMETRY_PUSH_METRICS: readonly MeshcoreTelemetryPushMetric[] = [
  'temperature',
  'humidity',
  'voltage',
  'pressure',
];

const CODECS: Record<MeshcoreTelemetryPushMetric, LppMinDeltaCodec> = {
  temperature: { lppType: 103, size: 2, multiplier: 10, signed: true },
  humidity: { lppType: 104, size: 2, multiplier: 10, signed: false },
  pressure: { lppType: 115, size: 2, multiplier: 10, signed: false },
  voltage: { lppType: 116, size: 2, multiplier: 100, signed: false },
};

export function meshcoreTelemetryPushMetricForLppType(
  lppType: number,
): MeshcoreTelemetryPushMetric | null {
  for (const metric of MESHCORE_TELEMETRY_PUSH_METRICS) {
    if (CODECS[metric].lppType === lppType) return metric;
  }
  return null;
}

/** Big-endian scaled integer, matching `LPPData::putFloat`. */
function putScaled(value: number, codec: LppMinDeltaCodec): number[] {
  const max = codec.signed ? 2 ** (codec.size * 8 - 1) - 1 : 2 ** (codec.size * 8) - 1;
  let n = Math.round(Math.abs(value) * codec.multiplier);
  if (n > max) n = max;
  if (value < 0 && codec.signed) n = 2 ** (codec.size * 8) - n;
  const out: number[] = [];
  for (let i = codec.size - 1; i >= 0; i--) out.push((n >> (i * 8)) & 0xff);
  return out;
}

export interface MeshcoreLppChannelEntry {
  channel: number;
  type: number;
}

/**
 * Min-delta block for the metrics the sensor actually reports: one entry per metric, on the first
 * channel that carries it in `entries` (the sensor matches channel and type exactly). Metrics without
 * a positive threshold are skipped, and entries stop at the firmware's 14-byte limit.
 */
export function buildMeshcoreTelemetryMinDeltas(
  entries: readonly MeshcoreLppChannelEntry[],
  thresholds: MeshcoreTelemetryPushThresholds,
): Uint8Array {
  const out: number[] = [];
  for (const metric of MESHCORE_TELEMETRY_PUSH_METRICS) {
    const delta = thresholds[metric];
    if (delta == null || !Number.isFinite(delta) || delta <= 0) continue;
    const codec = CODECS[metric];
    const entry = entries.find((e) => e.type === codec.lppType);
    if (!entry) continue;
    const bytes = [entry.channel & 0xff, codec.lppType, ...putScaled(delta, codec)];
    if (out.length + bytes.length > MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MAX_BYTES) break;
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

export function clampMeshcoreTelemetryPushTimeoutSecs(secs: number): number {
  if (!Number.isFinite(secs)) return MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS;
  return Math.min(
    MESHCORE_TELEMETRY_PUSH_MAX_TIMEOUT_SECS,
    Math.max(MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS, Math.round(secs)),
  );
}

export function buildMeshcoreTelemetrySubscribeRequest(
  tag: number,
  timeoutSecs: number,
  minDeltas: Uint8Array,
): Uint8Array {
  if (
    minDeltas.length < MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MIN_BYTES ||
    minDeltas.length > MESHCORE_TELEMETRY_PUSH_MIN_DELTAS_MAX_BYTES
  ) {
    throw new Error(`telemetry push min-deltas must be 3..14 bytes, got ${minDeltas.length}`);
  }
  const secs = clampMeshcoreTelemetryPushTimeoutSecs(timeoutSecs);
  const out = new Uint8Array(9 + minDeltas.length);
  const view = new DataView(out.buffer);
  out[0] = MESHCORE_REQ_TYPE_TELEMETRY_SUBSCRIBE;
  view.setUint32(1, tag >>> 0, true);
  view.setUint16(5, secs, true);
  out[7] = 0;
  out[8] = minDeltas.length;
  out.set(minDeltas, 9);
  return out;
}

export function buildMeshcoreTelemetryUnsubscribeRequest(): Uint8Array {
  return Uint8Array.of(MESHCORE_REQ_TYPE_TELEMETRY_UNSUBSCRIBE);
}

export interface MeshcoreTelemetrySubscribeReply {
  /** 0 when the sensor rejected the subscription (bad deltas, no region scope). */
  grantedSecs: number;
  /** Region scope the sensor will flood pushes on when it has no direct path. */
  scope: string;
}

/** Parses the tag-stripped binary response to a subscribe request. */
export function parseMeshcoreTelemetrySubscribeReply(
  data: Uint8Array,
): MeshcoreTelemetrySubscribeReply {
  if (data.length < 2) return { grantedSecs: 0, scope: '' };
  const grantedSecs = data[0] | (data[1] << 8);
  const scopeBytes = data.length > 4 ? data.subarray(4) : new Uint8Array();
  const nul = scopeBytes.indexOf(0);
  const scope = new TextDecoder().decode(nul >= 0 ? scopeBytes.subarray(0, nul) : scopeBytes);
  return { grantedSecs, scope };
}

export interface MeshcoreTelemetryPushPayload {
  /** Sensor RTC seconds when the reading was taken. */
  timestamp: number;
  lpp: Uint8Array;
}

/** Parses meshcore.js `responseData` of an unsolicited 0x8C push (tag already removed). */
export function parseMeshcoreTelemetryPushPayload(
  data: Uint8Array,
): MeshcoreTelemetryPushPayload | null {
  if (data.length < 4) return null;
  const timestamp = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
  return { timestamp, lpp: data.subarray(4) };
}

export function meshcoreTelemetryResubscribeDelayMs(grantedSecs: number): number {
  return Math.max(
    MESHCORE_TELEMETRY_PUSH_MIN_TIMEOUT_SECS * 500,
    Math.floor(grantedSecs * 1000 * MESHCORE_TELEMETRY_PUSH_RESUBSCRIBE_FRACTION),
  );
}

/** Non-zero random 32-bit tag; zero is the sensor's "not subscribed" value. */
export function randomMeshcoreTelemetryPushTag(
  random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0],
): number {
  for (;;) {
    const tag = random() >>> 0;
    if (tag !== 0) return tag;
  }
}

export interface MeshcoreTelemetryPushOptions {
  timeoutSecs: number;
  thresholds: MeshcoreTelemetryPushThresholds;
}

export interface MeshcoreTelemetryPushSubscription {
  nodeId: number;
  tag: number;
  options: MeshcoreTelemetryPushOptions;
  grantedSecs: number;
  subscribedAt: number;
  lastPushAt: number | null;
}

/**
 * Active subscriptions keyed by node, with a tag index for push routing and one re-subscribe timer
 * per node. Pausing keeps the subscriptions (for re-subscribe after reconnect); clearing forgets them.
 */
export class MeshcoreTelemetryPushRegistry {
  private readonly byNode = new Map<number, MeshcoreTelemetryPushSubscription>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  get(nodeId: number): MeshcoreTelemetryPushSubscription | undefined {
    return this.byNode.get(nodeId);
  }

  findByTag(tag: number): MeshcoreTelemetryPushSubscription | undefined {
    const t = tag >>> 0;
    for (const sub of this.byNode.values()) {
      if (sub.tag === t) return sub;
    }
    return undefined;
  }

  list(): MeshcoreTelemetryPushSubscription[] {
    return [...this.byNode.values()];
  }

  set(sub: MeshcoreTelemetryPushSubscription): void {
    this.byNode.set(sub.nodeId, sub);
  }

  markPush(nodeId: number, at: number): MeshcoreTelemetryPushSubscription | undefined {
    const sub = this.byNode.get(nodeId);
    if (!sub) return undefined;
    const next = { ...sub, lastPushAt: at };
    this.byNode.set(nodeId, next);
    return next;
  }

  scheduleResubscribe(nodeId: number, delayMs: number, run: () => void): void {
    this.cancelTimer(nodeId);
    this.timers.set(
      nodeId,
      setTimeout(() => {
        this.timers.delete(nodeId);
        run();
      }, delayMs),
    );
  }

  delete(nodeId: number): void {
    this.cancelTimer(nodeId);
    this.byNode.delete(nodeId);
  }

  pauseAll(): void {
    for (const id of [...this.timers.keys()]) this.cancelTimer(id);
  }

  clearAll(): void {
    this.pauseAll();
    this.byNode.clear();
  }

  private cancelTimer(nodeId: number): void {
    const t = this.timers.get(nodeId);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(nodeId);
  }
}
