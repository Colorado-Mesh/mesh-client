import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh, Portnums, StoreForward } from '@meshtastic/protobufs';

/** Duration after MQTT connect during which inbound messages are treated as backlog. */
export const MQTT_RECONNECT_BACKLOG_MS = 30_000;

/** Max messages for automatic CLIENT_HISTORY (Android uses ~25). */
export const SF_AUTO_HISTORY_MESSAGE_CAP = 50;

/** Max messages for manual “catch up” CLIENT_HISTORY. */
export const SF_MANUAL_HISTORY_MESSAGE_CAP = 100;

/** Skip auto-fetch if last successful fetch for this server was within this window. */
export const SF_AUTO_HISTORY_COOLDOWN_MS = 15 * 60 * 1000;

/** Require RF to have been disconnected at least this long before auto-fetch. */
export const SF_AUTO_HISTORY_OFFLINE_MIN_MS = 5 * 60 * 1000;

/** When router heartbeat period is 0, use this window instead of server default. */
export const SF_AUTO_HISTORY_WINDOW_CAP_MIN = 120;

export const SF_HISTORY_FETCH_STATE_STORAGE_KEY = 'mesh-client:sfHistoryFetchByServer';

export function mqttMessageTreatAsHistory(now: number, reconnectBacklogUntil: number): boolean {
  return reconnectBacklogUntil > 0 && now < reconnectBacklogUntil;
}

export interface StoreForwardHistoryRequestOptions {
  /** History window in minutes; 0 lets the server use its configured default. */
  windowMinutes?: number;
  /** Index from a prior ROUTER_HISTORY response; 0 for first request. */
  lastRequest?: number;
  /** Max messages to return; 0 lets the server decide (avoid for auto-fetch). */
  messageCap?: number;
}

export interface StoreForwardHeartbeatInfo {
  period: number;
  secondary: number;
}

export interface StoreForwardHistoryInfo {
  historyMessages: number;
  window: number;
  lastRequest: number;
}

export interface BuildStoreForwardHistoryToRadioParams {
  from: number;
  to: number;
  channel: number;
  packetId: number;
  windowMinutes?: number;
  lastRequest?: number;
  messageCap?: number;
}

export interface ShouldRequestStoreForwardHistoryParams {
  /** ROUTER_HEARTBEAT secondary field; primary server uses 0. */
  heartbeatSecondary: number;
  /** Connected radio module config: is_server. */
  connectedIsStoreForwardServer: boolean;
  /** Server node id already requested this session. */
  alreadyRequestedServer: boolean;
  /** Device must be configured before requesting. */
  deviceConfigured: boolean;
}

export interface ShouldAutoRequestStoreForwardHistoryParams extends ShouldRequestStoreForwardHistoryParams {
  autoFetchEnabled: boolean;
  now: number;
  lastFetchMs: number | null;
  lastDisconnectMs: number | null;
  cooldownMs?: number;
  offlineMinMs?: number;
}

export type SfHistoryFetchState = Record<string, number>;

/** Build CLIENT_HISTORY request bytes for STORE_FORWARD_APP port. */
export function buildStoreForwardHistoryRequestBytes(
  options: StoreForwardHistoryRequestOptions = {},
): Uint8Array {
  const windowMinutes = options.windowMinutes ?? 0;
  const lastRequest = options.lastRequest ?? 0;
  const historyMessages = options.messageCap ?? 0;
  const msg = create(StoreForward.StoreAndForwardSchema, {
    rr: StoreForward.StoreAndForward_RequestResponse.CLIENT_HISTORY,
    variant: {
      case: 'history',
      value: create(StoreForward.StoreAndForward_HistorySchema, {
        historyMessages,
        window: windowMinutes,
        lastRequest,
      }),
    },
  });
  return toBinary(StoreForward.StoreAndForwardSchema, msg);
}

function parseStoreForwardPacket(data: Uint8Array): {
  rr: number;
  variant: { case?: string; value?: unknown };
} | null {
  if (!data.length) return null;
  try {
    return fromBinary(StoreForward.StoreAndForwardSchema, data) as unknown as {
      rr: number;
      variant: { case?: string; value?: unknown };
    };
  } catch {
    // catch-no-log-ok malformed StoreAndForward protobuf
    return null;
  }
}

/** Parse ROUTER_HEARTBEAT payload; null if not a heartbeat variant. */
export function parseStoreForwardHeartbeat(data: Uint8Array): StoreForwardHeartbeatInfo | null {
  const parsed = parseStoreForwardPacket(data);
  if (!parsed || parsed.rr !== StoreForward.StoreAndForward_RequestResponse.ROUTER_HEARTBEAT) {
    return null;
  }
  if (parsed.variant.case !== 'heartbeat' || !parsed.variant.value) return null;
  const hb = parsed.variant.value as { period?: number; secondary?: number };
  return {
    period: hb.period ?? 0,
    secondary: hb.secondary ?? 0,
  };
}

/** Parse ROUTER_HISTORY payload; null if not a history variant. */
export function parseStoreForwardHistory(data: Uint8Array): StoreForwardHistoryInfo | null {
  const parsed = parseStoreForwardPacket(data);
  if (!parsed || parsed.rr !== StoreForward.StoreAndForward_RequestResponse.ROUTER_HISTORY) {
    return null;
  }
  if (parsed.variant.case !== 'history' || !parsed.variant.value) return null;
  const hist = parsed.variant.value as {
    historyMessages?: number;
    window?: number;
    lastRequest?: number;
  };
  return {
    historyMessages: hist.historyMessages ?? 0,
    window: hist.window ?? 0,
    lastRequest: hist.lastRequest ?? 0,
  };
}

/** Build ToRadio bytes for a direct CLIENT_HISTORY request (no SDK queue ack wait). */
export function buildStoreForwardHistoryToRadioBytes(
  params: BuildStoreForwardHistoryToRadioParams,
): Uint8Array {
  const payload = buildStoreForwardHistoryRequestBytes({
    windowMinutes: params.windowMinutes,
    lastRequest: params.lastRequest,
    messageCap: params.messageCap,
  });
  const meshPacket = create(Mesh.MeshPacketSchema, {
    payloadVariant: {
      case: 'decoded',
      value: {
        payload,
        portnum: Portnums.PortNum.STORE_FORWARD_APP,
        wantResponse: false,
      },
    },
    from: params.from,
    to: params.to,
    id: params.packetId,
    wantAck: false,
    channel: params.channel,
  });
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: meshPacket },
  });
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

/** Whether to send CLIENT_HISTORY in response to a router heartbeat. */
export function shouldRequestStoreForwardHistoryOnHeartbeat(
  params: ShouldRequestStoreForwardHistoryParams,
): boolean {
  if (!params.deviceConfigured) return false;
  if (params.connectedIsStoreForwardServer) return false;
  if (params.heartbeatSecondary !== 0) return false;
  if (params.alreadyRequestedServer) return false;
  return true;
}

/** Window minutes for auto CLIENT_HISTORY (caps server-default floods). */
export function resolveAutoStoreForwardHistoryWindowMinutes(heartbeatPeriod: number): number {
  if (heartbeatPeriod > 0) {
    return Math.min(heartbeatPeriod, SF_AUTO_HISTORY_WINDOW_CAP_MIN);
  }
  return SF_AUTO_HISTORY_WINDOW_CAP_MIN;
}

/** Auto-fetch gates: base heartbeat rules plus cooldown, offline, and user opt-out. */
export function shouldAutoRequestStoreForwardHistoryOnHeartbeat(
  params: ShouldAutoRequestStoreForwardHistoryParams,
): boolean {
  if (!shouldRequestStoreForwardHistoryOnHeartbeat(params)) return false;
  if (!params.autoFetchEnabled) return false;

  const cooldownMs = params.cooldownMs ?? SF_AUTO_HISTORY_COOLDOWN_MS;
  const offlineMinMs = params.offlineMinMs ?? SF_AUTO_HISTORY_OFFLINE_MIN_MS;

  if (params.lastFetchMs != null && params.now - params.lastFetchMs < cooldownMs) {
    return false;
  }

  if (params.lastDisconnectMs != null && params.now - params.lastDisconnectMs < offlineMinMs) {
    return false;
  }

  return true;
}

function parseSfHistoryFetchState(raw: string | null): SfHistoryFetchState {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SfHistoryFetchState = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    // catch-no-log-ok corrupt localStorage
    return {};
  }
}

export function loadSfHistoryFetchState(): SfHistoryFetchState {
  if (typeof localStorage === 'undefined') return {};
  return parseSfHistoryFetchState(localStorage.getItem(SF_HISTORY_FETCH_STATE_STORAGE_KEY));
}

export function getLastSfHistoryFetchMs(
  serverNodeId: number,
  state: SfHistoryFetchState = loadSfHistoryFetchState(),
): number | null {
  const ts = state[String(serverNodeId)];
  return ts != null && ts > 0 ? ts : null;
}

export interface ObservedStoreForwardPacket {
  data: Uint8Array;
  timestamp: number;
}

/** Pick primary S&F server from cached packets (latest ROUTER_HEARTBEAT) or preferred id. */
export function resolveStoreForwardServerFromObservedPackets(
  packetsByNode: ReadonlyMap<number, readonly ObservedStoreForwardPacket[]>,
  preferredServerId: number | null,
): { serverNodeId: number; heartbeatPeriod: number } | null {
  const latestPrimaryHeartbeat = (
    packets: readonly ObservedStoreForwardPacket[],
  ): { heartbeatPeriod: number } | null => {
    let latest: { ts: number; heartbeatPeriod: number } | null = null;
    for (const p of packets) {
      const hb = parseStoreForwardHeartbeat(p.data);
      if (hb?.secondary !== 0) continue;
      if (!latest || p.timestamp > latest.ts) {
        latest = { ts: p.timestamp, heartbeatPeriod: hb.period };
      }
    }
    if (!latest) return null;
    return { heartbeatPeriod: latest.heartbeatPeriod };
  };

  if (preferredServerId != null) {
    const preferredPackets = packetsByNode.get(preferredServerId);
    if (preferredPackets) {
      const hb = latestPrimaryHeartbeat(preferredPackets);
      return {
        serverNodeId: preferredServerId,
        heartbeatPeriod: hb?.heartbeatPeriod ?? 0,
      };
    }
  }

  let best: { serverNodeId: number; ts: number; heartbeatPeriod: number } | null = null;
  for (const [nodeId, packets] of packetsByNode) {
    for (const p of packets) {
      const hb = parseStoreForwardHeartbeat(p.data);
      if (hb?.secondary !== 0) continue;
      if (!best || p.timestamp > best.ts) {
        best = { serverNodeId: nodeId, ts: p.timestamp, heartbeatPeriod: hb.period };
      }
    }
  }
  if (best) {
    return { serverNodeId: best.serverNodeId, heartbeatPeriod: best.heartbeatPeriod };
  }
  return null;
}

export function recordSfHistoryFetch(
  serverNodeId: number,
  now: number = Date.now(),
): SfHistoryFetchState {
  const state = { ...loadSfHistoryFetchState(), [String(serverNodeId)]: now };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SF_HISTORY_FETCH_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // catch-no-log-ok quota or private mode
    }
  }
  return state;
}

/** Reserve a one-shot history request for this server per session; false if already reserved. */
export function reserveStoreForwardHistoryRequest(
  requestedServers: Set<number>,
  serverNodeId: number,
): boolean {
  if (requestedServers.has(serverNodeId)) return false;
  requestedServers.add(serverNodeId);
  return true;
}

/** Undo reservation after a failed transport write so the next heartbeat can retry. */
export function releaseStoreForwardHistoryRequest(
  requestedServers: Set<number>,
  serverNodeId: number,
): void {
  requestedServers.delete(serverNodeId);
}

/** Max share of control bytes (excluding tab/LF/CR) before payload is treated as non-chat. */
export {
  decodeStoreForwardTextPayload,
  isLikelyReadableChatText,
  MESHTASTIC_CHAT_CONTROL_BYTE_RATIO_MAX,
  type ResolvedMeshtasticTextPayload,
  resolveMeshtasticTextMessagePayload,
} from '@/shared/meshtasticTextMessagePayload';

let toRadioDirectWriteChain: Promise<void> = Promise.resolve();

const TO_RADIO_WRITER_LOCK_MAX_ATTEMPTS = 5;
const TO_RADIO_WRITER_LOCK_RETRY_MS = 25;

const WRITABLE_STREAM_LOCKED_PATTERN = /WritableStream is locked/i;

function isWritableStreamLockedError(error: unknown): boolean {
  if (error instanceof Error) {
    return WRITABLE_STREAM_LOCKED_PATTERN.test(error.message);
  }
  return typeof error === 'string' && WRITABLE_STREAM_LOCKED_PATTERN.test(error);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeToRadioDirectOnce(device: MeshDevice, toRadioBytes: Uint8Array): Promise<void> {
  const writer = device.transport.toDevice.getWriter();
  try {
    await writer.write(toRadioBytes);
  } finally {
    writer.releaseLock();
  }
}

/**
 * Retry getWriter when MeshDevice SDK traffic holds the transport lock.
 * Failure point: lock never clears within retry budget.
 * Fallback: rethrow so caller logs and may retry on next S&F heartbeat.
 */
async function writeToRadioDirectWithLockRetry(
  device: MeshDevice,
  toRadioBytes: Uint8Array,
): Promise<void> {
  for (let attempt = 1; attempt <= TO_RADIO_WRITER_LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      await writeToRadioDirectOnce(device, toRadioBytes);
      return;
    } catch (e: unknown) {
      if (!isWritableStreamLockedError(e) || attempt >= TO_RADIO_WRITER_LOCK_MAX_ATTEMPTS) {
        throw e;
      }
      await sleepMs(TO_RADIO_WRITER_LOCK_RETRY_MS * attempt);
    }
  }
}

/**
 * Write ToRadio bytes directly to the transport, bypassing MeshDevice queue ack wait.
 * Serialized so concurrent direct writes do not race getWriter(); retries when the SDK
 * holds the WritableStream writer lock.
 * Failure point: transport write rejects (BLE disconnect, backpressure).
 * Fallback: caller logs and may retry on next heartbeat.
 */
export async function writeToRadioWithoutQueue(
  device: MeshDevice,
  toRadioBytes: Uint8Array,
): Promise<void> {
  const run = (): Promise<void> => writeToRadioDirectWithLockRetry(device, toRadioBytes);
  const next = toRadioDirectWriteChain.then(run, run);
  toRadioDirectWriteChain = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
}

export interface HistoryMessageDedupFields {
  isHistory?: boolean;
  sender_id: number;
  payload: string;
  timestamp?: number;
}

export function isDuplicateHistoryMessage(
  messages: HistoryMessageDedupFields[],
  candidate: HistoryMessageDedupFields,
  windowMs = 5000,
): boolean {
  return messages.some(
    (m) =>
      m.isHistory &&
      m.sender_id === candidate.sender_id &&
      m.payload === candidate.payload &&
      Math.abs((m.timestamp ?? 0) - (candidate.timestamp ?? 0)) < windowMs,
  );
}
