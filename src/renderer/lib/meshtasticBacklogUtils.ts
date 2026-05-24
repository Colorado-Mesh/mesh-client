import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh, Portnums, StoreForward } from '@meshtastic/protobufs';

/** Duration after MQTT connect during which inbound messages are treated as backlog. */
export const MQTT_RECONNECT_BACKLOG_MS = 30_000;

export function mqttMessageTreatAsHistory(now: number, reconnectBacklogUntil: number): boolean {
  return reconnectBacklogUntil > 0 && now < reconnectBacklogUntil;
}

export interface StoreForwardHistoryRequestOptions {
  /** History window in minutes; 0 lets the server use its configured default. */
  windowMinutes?: number;
  /** Index from a prior ROUTER_HISTORY response; 0 for first request. */
  lastRequest?: number;
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

/** Build CLIENT_HISTORY request bytes for STORE_FORWARD_APP port. */
export function buildStoreForwardHistoryRequestBytes(
  options: StoreForwardHistoryRequestOptions = {},
): Uint8Array {
  const windowMinutes = options.windowMinutes ?? 0;
  const lastRequest = options.lastRequest ?? 0;
  const msg = create(StoreForward.StoreAndForwardSchema, {
    rr: StoreForward.StoreAndForward_RequestResponse.CLIENT_HISTORY,
    variant: {
      case: 'history',
      value: create(StoreForward.StoreAndForward_HistorySchema, {
        historyMessages: 0,
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
export const MESHTASTIC_CHAT_CONTROL_BYTE_RATIO_MAX = 0.25;

export interface ResolvedMeshtasticTextPayload {
  text: string;
  viaStoreForward?: boolean;
}

/**
 * Returns false when payload is mostly non-printable control bytes (corrupt decrypt, mis-ported SF).
 */
export function isLikelyReadableChatText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  let control = 0;
  for (const b of bytes) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) control++;
  }
  return control / bytes.length <= MESHTASTIC_CHAT_CONTROL_BYTE_RATIO_MAX;
}

/**
 * Resolve TEXT_MESSAGE_APP payload for chat ingest (RF and MQTT).
 * Failure point: mis-ported StoreAndForward or corrupt binary on text port.
 * Fallback: return null so callers skip chat insert.
 */
export function resolveMeshtasticTextMessagePayload(
  data: Uint8Array,
): ResolvedMeshtasticTextPayload | null {
  const sfText = decodeStoreForwardTextPayload(data);
  if (sfText != null) {
    return { text: sfText, viaStoreForward: true };
  }

  const parsed = parseStoreForwardPacket(data);
  if (parsed && parsed.variant.case !== 'text') {
    return null;
  }

  if (!isLikelyReadableChatText(data)) {
    return null;
  }

  const text = new TextDecoder().decode(data);
  return { text };
}

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

export function decodeStoreForwardTextPayload(data: Uint8Array): string | null {
  const parsed = parseStoreForwardPacket(data);
  if (!parsed) return null;
  if (parsed.variant.case !== 'text') return null;
  const textBytes = parsed.variant.value;
  if (!(textBytes instanceof Uint8Array) || !textBytes.length) return null;
  const text = new TextDecoder().decode(textBytes).trim();
  return text || null;
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
