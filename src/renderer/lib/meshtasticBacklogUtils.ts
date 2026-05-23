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

/**
 * Write ToRadio bytes directly to the transport, bypassing MeshDevice queue ack wait.
 * Failure point: transport write rejects (BLE disconnect, backpressure).
 * Fallback: caller logs and may retry on next heartbeat.
 */
export async function writeToRadioWithoutQueue(
  device: MeshDevice,
  toRadioBytes: Uint8Array,
): Promise<void> {
  const writer = device.transport.toDevice.getWriter();
  try {
    await writer.write(toRadioBytes);
  } finally {
    writer.releaseLock();
  }
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
