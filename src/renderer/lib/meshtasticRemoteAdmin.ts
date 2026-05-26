import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';

import { errLikeToLogString } from './errLikeToLogString';
import { writeToRadioWithoutQueue } from './meshtasticBacklogUtils';
import { parseMeshtasticAdminKeyBase64 } from './meshtasticRemoteAdminKeyStorage';

interface AdminMessagePayloadVariant {
  case: string;
  value?: unknown;
}

interface AdminMessage {
  sessionPasskey?: Uint8Array;
  payloadVariant: AdminMessagePayloadVariant;
}

function adminMessage(init: Record<string, unknown>): AdminMessage {
  return create(Admin.AdminMessageSchema, init) as unknown as AdminMessage;
}

interface MeshPacketDecoded {
  portnum?: number;
  payload?: Uint8Array;
  requestId?: number;
  replyId?: number;
}

interface MeshPacket {
  id?: number;
  from?: number;
  to?: number;
  hopLimit?: number;
  hopStart?: number;
  pkiEncrypted?: boolean;
  channel?: number;
  payloadVariant?: { case?: string; value?: MeshPacketDecoded };
}

/** Default hop budget for multi-hop PKI admin (protobuf otherwise defaults hopLimit to 0). */
export const REMOTE_ADMIN_PACKET_HOP_LIMIT = 7;

function adminPayloadCase(message: AdminMessage): string | undefined {
  return message.payloadVariant?.case;
}

/** Meshtastic Android PKC sentinel; channel field is omitted on wire for PKI admin. */
export const REMOTE_ADMIN_PKC_CHANNEL_INDEX = 8;

/** Firmware session_passkey TTL (AdminModule.cpp). */
export const REMOTE_ADMIN_SESSION_TTL_MS = 300_000;

/**
 * "Active enough to navigate" window (Android SessionManagerImpl). Below firmware TTL to leave
 * headroom for multi-hop latency before the next admin read.
 */
export const REMOTE_ADMIN_SESSION_ACTIVE_MS = 240_000;

/** Default wait for multi-hop admin responses. */
export const REMOTE_ADMIN_RESPONSE_TIMEOUT_MS = 120_000;

/** Session-key exchange; fail faster so essential snapshot does not stall on one hop. */
export const REMOTE_ADMIN_SESSION_KEY_TIMEOUT_MS = 45_000;

/** Per-read timeout for essential snapshot when a response is not correlated promptly. */
export const REMOTE_ADMIN_ESSENTIAL_RESPONSE_TIMEOUT_MS = 25_000;

/** Single attempt on essential reads once request/response ids are wired correctly. */
export const REMOTE_ADMIN_ESSENTIAL_MAX_ATTEMPTS = 1;

/** Wall-clock cap for security config snapshot fetch. */
export const REMOTE_ADMIN_SECURITY_LOADING_WATCHDOG_MS = 45_000;

/** Must match MODULE_CONFIG_FETCHES length in meshtasticRemoteAdminSnapshot.ts. */
export const REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT = 13;

/** Wall-clock cap for modules snapshot fetch (13 sequential multi-hop reads). */
export const REMOTE_ADMIN_MODULES_LOADING_WATCHDOG_MS =
  REMOTE_ADMIN_MODULE_CONFIG_FETCH_COUNT * 8_000 + 30_000;

export type RemoteConfigLoadingRoute = 'radio' | 'security' | 'modules';

export function remoteConfigLoadingWatchdogMsForRoute(route: RemoteConfigLoadingRoute): number {
  switch (route) {
    case 'radio':
      return REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS;
    case 'security':
      return REMOTE_ADMIN_SECURITY_LOADING_WATCHDOG_MS;
    case 'modules':
      return REMOTE_ADMIN_MODULES_LOADING_WATCHDOG_MS;
  }
}

/** Serializes remote config snapshot fetches so admin reads do not overlap on one client. */
export function createSerialTaskQueue(): {
  enqueue: (task: () => Promise<void>) => Promise<void>;
} {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task: () => Promise<void>): Promise<void> {
      const next = chain.then(task, task);
      chain = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

/** Pause between sequential remote config fetches (BLE write pacing on mutating ops). */
export const REMOTE_ADMIN_CONFIG_FETCH_DELAY_MS = 200;

/** No pause between read-only essential snapshot fetches (multi-hop RTT dominates). */
export const REMOTE_ADMIN_ESSENTIAL_FETCH_DELAY_MS = 0;

/** Read-only admin gets: skip mesh wantAck to avoid ROUTING_APP races on multi-hop PKI. */
export const REMOTE_ADMIN_READ_SEND_OPTIONS: RemoteAdminSendOptions = { wantAck: false };

/** Backoff before retrying a failed config fetch (LoRa is most sensitive). */
export const REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS = 500;

export const REMOTE_ADMIN_LORA_CONFIG_MAX_ATTEMPTS = 3;

/** Pause before channel fetches 1–7 after configs (BLE settle). */
export const REMOTE_ADMIN_CHANNEL_LOOP_START_DELAY_MS = 500;

/** Pause between sequential remote channel fetches. */
export const REMOTE_ADMIN_CHANNEL_FETCH_DELAY_MS = 300;

export const REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS = 3;

export const REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS = 500;

/**
 * Worst-case wall time for the radio-route foreground snapshot (session bootstrap + channel 0
 * retries + LoRa read). Keeps UI watchdog aligned with PRIMARY_CHANNEL_FETCH_OPTIONS (3×120s).
 */
export function computeRemoteAdminRadioLoadingWatchdogMs(): number {
  const sessionBootstrapMs = REMOTE_ADMIN_SESSION_KEY_TIMEOUT_MS + REMOTE_ADMIN_RESPONSE_TIMEOUT_MS;
  const channel0Ms =
    REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS * REMOTE_ADMIN_RESPONSE_TIMEOUT_MS +
    (REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS - 1) * REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS;
  const loraMs = REMOTE_ADMIN_ESSENTIAL_MAX_ATTEMPTS * REMOTE_ADMIN_ESSENTIAL_RESPONSE_TIMEOUT_MS;
  const marginMs = 30_000;
  return sessionBootstrapMs + channel0Ms + loraMs + marginMs;
}

/** Wall-clock cap while UI shows loading for foreground radio snapshot fetch. */
export const REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS = computeRemoteAdminRadioLoadingWatchdogMs();

/** @deprecated Use {@link remoteConfigLoadingWatchdogMsForRoute} */
export const REMOTE_ADMIN_ESSENTIAL_LOADING_WATCHDOG_MS = REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS;

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Errors that may clear after session key exchange or a short BLE pause. */
export function isRemoteAdminRetryableError(message: string): boolean {
  return message === 'remoteAdmin.errors.timeout' || message === 'remoteAdmin.errors.badSessionKey';
}

/** ROUTING_APP codes that often precede a successful admin response on multi-hop reads. */
export function isBenignRoutingErrorForRead(error: RemoteAdminRoutingErrorCode): boolean {
  const RoutingError = Mesh.Routing_Error as Record<string, number>;
  return (
    error === RoutingError.NO_CHANNEL ||
    error === RoutingError.MAX_RETRANSMIT ||
    error === RoutingError.NO_RESPONSE ||
    error === RoutingError.TIMEOUT
  );
}

export type RemoteAdminRoutingErrorCode = number;

export interface RemoteAdminSessionEntry {
  passkey: Uint8Array;
  expiresAt: number;
}

/** Dest PKI key: prefer mesh NodeDB hex; fall back to stored admin key (base64). */
export function resolveMeshtasticDestPublicKeyBytes(params: {
  publicKeyHex?: string;
  adminKeyBase64?: string;
}): Uint8Array | undefined {
  const fromMesh = meshtasticNodePublicKeyBytesFromHex(params.publicKeyHex);
  if (fromMesh) return fromMesh;
  if (params.adminKeyBase64) {
    return parseMeshtasticAdminKeyBase64(params.adminKeyBase64);
  }
  return undefined;
}

export function meshtasticNodePublicKeyBytesFromHex(
  hex: string | undefined,
): Uint8Array | undefined {
  if (hex?.length !== 64) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) return undefined;
    bytes[i] = byte;
  }
  return bytes;
}

export type RemoteAdminSessionStatus = 'none' | 'active' | 'stale';

export class RemoteAdminSessionStore {
  private readonly sessions = new Map<number, RemoteAdminSessionEntry>();

  get(nodeNum: number): Uint8Array | undefined {
    const entry = this.sessions.get(nodeNum >>> 0);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.sessions.delete(nodeNum >>> 0);
      return undefined;
    }
    return entry.passkey;
  }

  getStatus(nodeNum: number, nowMs: number = Date.now()): RemoteAdminSessionStatus {
    const entry = this.sessions.get(nodeNum >>> 0);
    if (!entry) return 'none';
    if (nowMs >= entry.expiresAt) {
      this.sessions.delete(nodeNum >>> 0);
      return 'none';
    }
    const ageMs = nowMs - (entry.expiresAt - REMOTE_ADMIN_SESSION_TTL_MS);
    return ageMs < REMOTE_ADMIN_SESSION_ACTIVE_MS ? 'active' : 'stale';
  }

  set(nodeNum: number, passkey: Uint8Array): void {
    if (passkey.length !== 8) return;
    this.sessions.set(nodeNum >>> 0, {
      passkey: passkey.slice(),
      expiresAt: Date.now() + REMOTE_ADMIN_SESSION_TTL_MS,
    });
  }

  clear(nodeNum?: number): void {
    if (nodeNum == null) {
      this.sessions.clear();
      return;
    }
    this.sessions.delete(nodeNum >>> 0);
  }
}

export type ParsedAdminResponse =
  | { kind: 'admin'; message: AdminMessage; from: number; requestId: number }
  | { kind: 'routing_error'; error: RemoteAdminRoutingErrorCode; requestId: number; from: number };

export function extractAdminSessionPasskey(message: AdminMessage): Uint8Array | undefined {
  const key = message.sessionPasskey;
  if (key?.length !== 8) return undefined;
  return key.slice();
}

/** Map SDK / routing failures to i18n keys under `remoteAdmin.errors.*`. */
export function normalizeRemoteAdminError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message;
    if (msg.startsWith('remoteAdmin.errors.')) return msg;
    const RoutingError = Mesh.Routing_Error as Record<string, number>;
    for (const [name, code] of Object.entries(RoutingError)) {
      if (msg.includes(name)) return routingErrorToRemoteAdminKey(code);
    }
  }
  if (typeof e === 'object' && e !== null) {
    const o = e as { error?: number | string };
    if (typeof o.error === 'number') {
      return routingErrorToRemoteAdminKey(o.error);
    }
    if (typeof o.error === 'string') {
      const RoutingError = Mesh.Routing_Error as Record<string, number>;
      const code = RoutingError[o.error];
      if (code != null) return routingErrorToRemoteAdminKey(code);
    }
  }
  return 'remoteAdmin.errors.generic';
}

export function routingErrorToRemoteAdminKey(error: RemoteAdminRoutingErrorCode): string {
  const RoutingError = Mesh.Routing_Error as Record<string, number>;
  switch (error) {
    case RoutingError.ADMIN_PUBLIC_KEY_UNAUTHORIZED:
      return 'remoteAdmin.errors.publicKeyUnauthorized';
    case RoutingError.ADMIN_BAD_SESSION_KEY:
      return 'remoteAdmin.errors.badSessionKey';
    case RoutingError.PKI_FAILED:
    case RoutingError.PKI_UNKNOWN_PUBKEY:
    case RoutingError.PKI_SEND_FAIL_PUBLIC_KEY:
      return 'remoteAdmin.errors.pkiFailed';
    case RoutingError.NOT_AUTHORIZED:
      return 'remoteAdmin.errors.notAuthorized';
    case RoutingError.TIMEOUT:
    case RoutingError.NO_RESPONSE:
    case RoutingError.MAX_RETRANSMIT:
    case RoutingError.NO_CHANNEL:
      return 'remoteAdmin.errors.timeout';
    default:
      return 'remoteAdmin.errors.generic';
  }
}

export async function retryRemoteAdminOp<T>(
  operation: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    backoffMs?: number;
    isRetryable?: (message: string) => boolean;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? REMOTE_ADMIN_LORA_CONFIG_MAX_ATTEMPTS;
  const backoffMs = options?.backoffMs ?? REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS;
  const isRetryable = options?.isRetryable ?? isRemoteAdminRetryableError;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      const msg =
        e instanceof Error && e.message.startsWith('remoteAdmin.errors.')
          ? e.message
          : normalizeRemoteAdminError(e);
      lastError = new Error(msg);
      const canRetry = attempt + 1 < maxAttempts && isRetryable(msg);
      if (!canRetry) throw lastError;
      await delayMs(backoffMs);
    }
  }
  throw lastError ?? new Error('remoteAdmin.errors.generic');
}

interface ResolveAdminRequestIdContext {
  pending?: Map<number, PendingRemoteAdmin>;
  from?: number;
}

/** Returns true when an ADMIN_APP response case cannot satisfy the pending read's expected cases. */
export function isCrossTypeAdminReadResponse(
  responseCase: string,
  expectedResponseCases: readonly string[] | undefined,
): boolean {
  if (!expectedResponseCases?.length) return false;
  return !expectedResponseCases.includes(responseCase);
}

/** Ignore stale cross-read ADMIN_APP instead of failing the active pending read. */
export function shouldIgnoreStaleAdminResponse(params: {
  responseCase: string;
  expectedResponseCases?: readonly string[];
  tombstoneResponseCase?: string;
}): boolean {
  if (!isCrossTypeAdminReadResponse(params.responseCase, params.expectedResponseCases)) {
    return false;
  }
  if (params.responseCase === 'getDeviceMetadataResponse') {
    return true;
  }
  // Only ignore when the same request id was already resolved to a different response case.
  // Otherwise, treat cross-type mismatches as active-request errors so callers fail fast.
  return (
    typeof params.tombstoneResponseCase === 'string' &&
    params.tombstoneResponseCase.length > 0 &&
    params.tombstoneResponseCase !== params.responseCase
  );
}

export function resolveAdminRequestId(
  meshPacket: MeshPacket,
  dataRequestId: number,
  context?: ResolveAdminRequestIdContext,
): number {
  if (dataRequestId !== 0) return dataRequestId >>> 0;
  const data = meshPacket.payloadVariant?.value;
  const replyId = data?.replyId;
  // Multi-hop admin responses use a new mesh packet id; replyId matches our pending request.
  if (typeof replyId === 'number' && Number.isFinite(replyId) && replyId !== 0) {
    return replyId >>> 0;
  }
  const pending = context?.pending;
  const from = context?.from;
  if (pending?.size === 1 && from != null) {
    const solePending = pending.values().next().value!;
    const fromNum = from >>> 0;
    if (fromNum === solePending.destNodeNum || fromNum === 0) {
      const packetId = meshPacket.id;
      if (typeof packetId === 'number' && Number.isFinite(packetId) && packetId !== 0) {
        return packetId >>> 0;
      }
    }
  }
  return 0;
}

export function parseIncomingRemoteAdminPacket(
  meshPacket: MeshPacket,
  context?: ResolveAdminRequestIdContext,
): ParsedAdminResponse | null {
  if (meshPacket.payloadVariant?.case !== 'decoded') return null;
  const data = meshPacket.payloadVariant.value;
  if (data == null || meshPacket.from == null) return null;
  const from = meshPacket.from >>> 0;
  const resolveContext: ResolveAdminRequestIdContext = { ...context, from };

  if (data.portnum === Portnums.PortNum.ADMIN_APP && (data.payload?.length ?? 0) > 0) {
    try {
      const message = fromBinary(
        Admin.AdminMessageSchema,
        data.payload!,
      ) as unknown as AdminMessage;
      return {
        kind: 'admin',
        message,
        from,
        requestId: resolveAdminRequestId(meshPacket, (data.requestId ?? 0) >>> 0, resolveContext),
      };
    } catch {
      // catch-no-log-ok malformed ADMIN_APP payload on unrelated mesh traffic
      return null;
    }
  }

  if (data.portnum === Portnums.PortNum.ROUTING_APP && (data.payload?.length ?? 0) > 0) {
    try {
      const routing = fromBinary(Mesh.RoutingSchema, data.payload!) as {
        variant?: { case?: string; value?: number };
      };
      if (routing.variant?.case === 'errorReason') {
        const requestId = resolveAdminRequestId(
          meshPacket,
          (data.requestId ?? 0) >>> 0,
          resolveContext,
        );
        if (requestId !== 0 && routing.variant.value != null) {
          return {
            kind: 'routing_error',
            error: routing.variant.value,
            requestId,
            from,
          };
        }
      }
    } catch {
      // catch-no-log-ok malformed ROUTING_APP payload on unrelated mesh traffic
      return null;
    }
  }

  return null;
}

export function buildRemoteAdminToRadio(params: {
  myNodeNum: number;
  destNodeNum: number;
  adminPayload: Uint8Array;
  packetId: number;
  publicKey: Uint8Array;
  wantAck?: boolean;
  wantResponse?: boolean;
}): Uint8Array {
  const meshPacket = create(Mesh.MeshPacketSchema, {
    from: params.myNodeNum >>> 0,
    to: params.destNodeNum >>> 0,
    id: params.packetId >>> 0,
    hopLimit: REMOTE_ADMIN_PACKET_HOP_LIMIT,
    hopStart: REMOTE_ADMIN_PACKET_HOP_LIMIT,
    wantAck: params.wantAck ?? true,
    pkiEncrypted: true,
    publicKey: params.publicKey,
    payloadVariant: {
      case: 'decoded',
      value: {
        portnum: Portnums.PortNum.ADMIN_APP,
        payload: params.adminPayload,
        wantResponse: params.wantResponse ?? true,
        requestId: params.packetId >>> 0,
      },
    },
  });
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: meshPacket },
  });
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

export interface RemoteAdminSendOptions {
  wantAck?: boolean;
  wantResponse?: boolean;
  timeoutMs?: number;
  /** When set, only accept admin responses matching these payloadVariant.case values. */
  expectedResponseCases?: readonly string[];
}

interface PendingRemoteAdmin {
  destNodeNum: number;
  packetId: number;
  adminCase?: string;
  expectedResponseCases?: readonly string[];
  timeoutMs: number;
  createdAt: number;
  resolve: (value: AdminMessage) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface RecentlyResolvedAdminEntry {
  responseCase: string;
  resolvedAt: number;
}

type PendingClearReason = 'resolve' | 'reject' | 'timeout' | 'reset';

export class MeshtasticRemoteAdminClient {
  readonly sessionStore = new RemoteAdminSessionStore();
  private readonly pending = new Map<number, PendingRemoteAdmin>();
  private readonly recentlyResolved = new Map<number, RecentlyResolvedAdminEntry>();
  private pendingEdit = false;
  private sendRawChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly getDevice: () => MeshDevice | null,
    private readonly getMyNodeNum: () => number,
    private readonly getDestPublicKey: (nodeNum: number) => Uint8Array | undefined,
  ) {}

  dispose(): void {
    this.resetEditState(new Error('Remote admin client disposed'));
    this.sessionStore.clear();
  }

  /** Clears in-flight requests and edit state (target switch, disconnect). */
  resetEditState(reason: Error = new Error('remoteAdmin.errors.generic')): void {
    for (const entry of [...this.pending.values()]) {
      this.rejectPending(entry.packetId, entry, reason, 'reset');
    }
    this.pending.clear();
    this.pendingEdit = false;
  }

  private pruneRecentlyResolved(nowMs: number = Date.now()): void {
    const cutoff = nowMs - REMOTE_ADMIN_RESPONSE_TIMEOUT_MS;
    for (const [id, entry] of this.recentlyResolved) {
      if (entry.resolvedAt < cutoff) {
        this.recentlyResolved.delete(id);
      }
    }
  }

  private recordResolvedRequestId(requestId: number, responseCase: string): void {
    this.recentlyResolved.set(requestId >>> 0, {
      responseCase,
      resolvedAt: Date.now(),
    });
    this.pruneRecentlyResolved();
  }

  private getRecentlyResolved(requestId: number): RecentlyResolvedAdminEntry | undefined {
    this.pruneRecentlyResolved();
    return this.recentlyResolved.get(requestId >>> 0);
  }

  private adminCorrelationFields(
    meshPacket: MeshPacket,
    parsed: Extract<ParsedAdminResponse, { kind: 'admin' }>,
  ): Record<string, string | number> {
    const data = meshPacket.payloadVariant?.value;
    return {
      requestId: parsed.requestId,
      dataRequestId: (data?.requestId ?? 0) >>> 0,
      replyId: (data?.replyId ?? 0) >>> 0,
      meshPacketId: (meshPacket.id ?? 0) >>> 0,
      from: parsed.from,
      responseCase: parsed.message.payloadVariant.case ?? '',
      pendingCount: this.pending.size,
    };
  }

  private logAdminCorrelation(
    action: string,
    fields: Record<string, string | number>,
    extra?: Record<string, string | number>,
  ): void {
    const parts = Object.entries({ ...fields, ...extra }).map(
      ([key, value]) => `${key}=${String(value)}`,
    );
    console.debug(`[MeshtasticRemoteAdmin] ${action} ${parts.join(' ')}`);
  }

  private rejectPending(
    requestId: number,
    pending: PendingRemoteAdmin,
    error: Error,
    reason: PendingClearReason,
    logFields?: Record<string, string | number>,
  ): void {
    clearTimeout(pending.timeoutId);
    this.pending.delete(requestId);
    const elapsedMs = Date.now() - pending.createdAt;
    if (reason === 'reject' || reason === 'timeout' || reason === 'reset') {
      this.recordResolvedRequestId(
        requestId,
        pending.expectedResponseCases?.[0] ?? pending.adminCase ?? 'unknown',
      );
    }
    this.logAdminCorrelation(`pending-${reason}`, {
      requestId,
      dest: pending.destNodeNum,
      timeoutMs: pending.timeoutMs,
      elapsedMs,
      expected: pending.expectedResponseCases?.join(',') ?? '',
      error: error.message,
      ...logFields,
    });
    pending.reject(error);
  }

  private finishPendingResolve(
    requestId: number,
    pending: PendingRemoteAdmin,
    message: AdminMessage,
    meshPacket: MeshPacket,
    parsed: Extract<ParsedAdminResponse, { kind: 'admin' }>,
  ): void {
    const responseCase = message.payloadVariant.case ?? '';
    this.logAdminCorrelation('resolve', this.adminCorrelationFields(meshPacket, parsed), {
      dest: pending.destNodeNum,
      elapsedMs: Date.now() - pending.createdAt,
    });
    clearTimeout(pending.timeoutId);
    this.pending.delete(requestId);
    this.recordResolvedRequestId(requestId, responseCase);
    pending.resolve(message);
  }

  private finishPendingReject(
    requestId: number,
    pending: PendingRemoteAdmin,
    error: Error,
    logFields?: Record<string, string | number>,
  ): void {
    this.rejectPending(requestId, pending, error, 'reject', logFields);
  }

  handleMeshPacket(meshPacket: MeshPacket): void {
    const variant = meshPacket.payloadVariant?.case;
    if (variant === 'encrypted') return;
    if (variant != null && variant !== 'decoded') return;

    const parsed = parseIncomingRemoteAdminPacket(meshPacket, { pending: this.pending });
    if (!parsed) return;

    if (parsed.kind === 'routing_error') {
      let requestId = parsed.requestId;
      if (requestId === 0 && this.pending.size === 1) {
        requestId = this.pending.keys().next().value!;
        console.debug(
          '[MeshtasticRemoteAdmin] ROUTING correlated to sole pending requestId=' +
            String(requestId),
        );
      } else if (requestId === 0) {
        console.debug(
          '[MeshtasticRemoteAdmin] ROUTING uncorrelated meshPacket.id=' +
            String(meshPacket.id ?? 0) +
            ' pendingCount=' +
            String(this.pending.size),
        );
        return;
      }

      const pending = this.pending.get(requestId);
      if (!pending) return;
      const key = routingErrorToRemoteAdminKey(parsed.error);
      // Failure point: wantAck routing ack can arrive before PKI admin response. Fallback: keep
      // waiting for the real ADMIN_APP response unless the routing error is fatal for admin/PKI.
      const isRead = (pending.expectedResponseCases?.length ?? 0) > 0;
      if (
        isRead &&
        (isBenignRoutingErrorForRead(parsed.error) || key === 'remoteAdmin.errors.generic')
      ) {
        console.debug(
          '[MeshtasticRemoteAdmin] ignoring benign ROUTING_APP requestId=' +
            String(requestId) +
            ' error=' +
            String(parsed.error) +
            ' mapped=' +
            key +
            ' dest=0x' +
            pending.destNodeNum.toString(16),
        );
        return;
      }
      console.debug(
        '[MeshtasticRemoteAdmin] ROUTING reject requestId=' +
          String(requestId) +
          ' error=' +
          String(parsed.error) +
          ' mapped=' +
          key +
          ' dest=0x' +
          pending.destNodeNum.toString(16),
      );
      this.finishPendingReject(requestId, pending, new Error(key), {
        routingError: parsed.error,
      });
      return;
    }

    const passkey = extractAdminSessionPasskey(parsed.message);
    if (passkey) {
      const pendingForPasskey =
        parsed.requestId !== 0 ? this.pending.get(parsed.requestId) : undefined;
      const sessionNode =
        parsed.from === 0 && pendingForPasskey != null
          ? pendingForPasskey.destNodeNum
          : parsed.from;
      this.sessionStore.set(sessionNode, passkey);
    }

    if (parsed.requestId === 0) {
      if (this.pending.size > 0) {
        this.logAdminCorrelation(
          'ignore-uncorrelated',
          this.adminCorrelationFields(meshPacket, parsed),
        );
      }
      return;
    }

    const pending = this.pending.get(parsed.requestId);
    if (!pending) {
      const tombstone = this.getRecentlyResolved(parsed.requestId);
      if (this.pending.size > 0) {
        this.logAdminCorrelation(
          tombstone ? 'ignore-stale-tombstone' : 'ignore-uncorrelated',
          this.adminCorrelationFields(meshPacket, parsed),
          tombstone ? { tombstoneCase: tombstone.responseCase } : undefined,
        );
      }
      return;
    }

    if (pending.destNodeNum !== parsed.from) {
      if (parsed.from === 0) {
        console.debug(
          '[MeshtasticRemoteAdmin] admin response from=0 correlated by requestId=' +
            String(parsed.requestId) +
            ' dest=0x' +
            pending.destNodeNum.toString(16),
        );
      } else {
        if (this.pending.size > 0) {
          this.logAdminCorrelation(
            'ignore-wrong-from',
            this.adminCorrelationFields(meshPacket, parsed),
            {
              dest: pending.destNodeNum,
            },
          );
        }
        return;
      }
    }

    const responseCase = parsed.message.payloadVariant.case;
    if (!responseCase) return;
    if (pending.expectedResponseCases && !pending.expectedResponseCases.includes(responseCase)) {
      const tombstone = this.getRecentlyResolved(parsed.requestId);
      if (
        shouldIgnoreStaleAdminResponse({
          responseCase,
          expectedResponseCases: pending.expectedResponseCases,
          tombstoneResponseCase: tombstone?.responseCase,
        })
      ) {
        this.logAdminCorrelation('ignore-stale', this.adminCorrelationFields(meshPacket, parsed), {
          dest: pending.destNodeNum,
          expected: pending.expectedResponseCases.join(','),
          elapsedMs: Date.now() - pending.createdAt,
          tombstoneCase: tombstone?.responseCase ?? '',
        });
        return;
      }
      const mismatchKey = pending.expectedResponseCases.includes('getChannelResponse')
        ? 'remoteAdmin.errors.channelResponseUnexpected'
        : 'remoteAdmin.errors.configResponseUnexpected';
      this.finishPendingReject(parsed.requestId, pending, new Error(mismatchKey), {
        ...this.adminCorrelationFields(meshPacket, parsed),
        responseCase,
        expected: pending.expectedResponseCases.join(','),
      });
      return;
    }
    this.finishPendingResolve(parsed.requestId, pending, parsed.message, meshPacket, parsed);
  }

  private generatePacketId(): number {
    const device = this.getDevice() as { generateRandId?: () => number } | null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const id =
        device?.generateRandId != null
          ? device.generateRandId() >>> 0
          : Math.floor(Math.random() * 0xffffffff) >>> 0;
      if (id !== 0 && !this.pending.has(id)) return id;
    }
    return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
  }

  private attachSessionPasskey(
    destNodeNum: number,
    message: AdminMessage,
    requireSession: boolean,
  ): AdminMessage {
    const passkey = this.sessionStore.get(destNodeNum);
    if (!passkey) {
      if (requireSession) {
        throw new Error('remoteAdmin.errors.badSessionKey');
      }
      return message;
    }
    return adminMessage({
      ...message,
      sessionPasskey: passkey,
    });
  }

  private resolveDestPublicKey(destNodeNum: number): Uint8Array {
    const publicKey = this.getDestPublicKey(destNodeNum);
    if (publicKey?.length === 32) return publicKey;
    throw new Error('remoteAdmin.errors.pkiFailed');
  }

  private buildRawAdminPacket(
    destNodeNum: number,
    message: AdminMessage,
    packetId: number,
    options: RemoteAdminSendOptions,
  ): Uint8Array {
    const myNodeNum = this.getMyNodeNum();
    const payload = toBinary(Admin.AdminMessageSchema, message as never);
    return buildRemoteAdminToRadio({
      myNodeNum,
      destNodeNum,
      adminPayload: payload,
      packetId,
      publicKey: this.resolveDestPublicKey(destNodeNum),
      wantAck: options.wantAck ?? true,
      wantResponse: options.wantResponse ?? true,
    });
  }

  private async sendRawAdmin(
    destNodeNum: number,
    message: AdminMessage,
    options: RemoteAdminSendOptions,
    packetId?: number,
  ): Promise<number> {
    const device = this.getDevice();
    const myNodeNum = this.getMyNodeNum();
    if (!device || myNodeNum <= 0) {
      throw new Error('remoteAdmin.errors.noLocalRadio');
    }

    const id = packetId ?? this.generatePacketId();
    const toRadio = this.buildRawAdminPacket(destNodeNum, message, id, options);

    const run = async (): Promise<number> => {
      try {
        await writeToRadioWithoutQueue(device, toRadio);
        return id;
      } catch (e) {
        console.warn(
          '[MeshtasticRemoteAdmin] writeToRadioWithoutQueue failed ' + errLikeToLogString(e),
        );
        throw e instanceof Error ? e : new Error(normalizeRemoteAdminError(e));
      }
    };

    const next = this.sendRawChain.then(run, run);
    this.sendRawChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private waitForAdminResponse(
    destNodeNum: number,
    packetId: number,
    options: RemoteAdminSendOptions,
    adminCase?: string,
  ): Promise<AdminMessage> {
    const timeoutMs = options.timeoutMs ?? REMOTE_ADMIN_RESPONSE_TIMEOUT_MS;
    const createdAt = Date.now();
    return new Promise<AdminMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pending = this.pending.get(packetId);
        if (!pending) return;
        this.rejectPending(packetId, pending, new Error('remoteAdmin.errors.timeout'), 'timeout');
      }, timeoutMs);

      this.pending.set(packetId, {
        destNodeNum: destNodeNum >>> 0,
        packetId,
        adminCase,
        expectedResponseCases: options.expectedResponseCases,
        timeoutMs,
        createdAt,
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  async sendAdminRequest(
    destNodeNum: number,
    buildMessage: () => AdminMessage,
    options: RemoteAdminSendOptions & { requireSession?: boolean },
  ): Promise<AdminMessage> {
    const message = this.attachSessionPasskey(
      destNodeNum,
      buildMessage(),
      options.requireSession ?? false,
    );
    const packetId = this.generatePacketId();
    const adminCase = adminPayloadCase(message);
    if (options.wantResponse === false) {
      await this.sendRawAdmin(destNodeNum, message, options, packetId);
      return adminMessage({});
    }
    const responsePromise = this.waitForAdminResponse(destNodeNum, packetId, options, adminCase);
    try {
      await this.sendRawAdmin(destNodeNum, message, options, packetId);
    } catch (e) {
      const pending = this.pending.get(packetId);
      if (pending) {
        const err = e instanceof Error ? e : new Error(normalizeRemoteAdminError(e));
        this.rejectPending(packetId, pending, err, 'reject', {
          stage: 'sendRawAdmin',
        });
      }
      // catch-no-log-ok write failure forwarded to responsePromise rejection for caller
    }
    return responsePromise;
  }

  /**
   * Establish a remote-admin session passkey when missing. Uses getDeviceMetadata (Android maps
   * SESSIONKEY bootstrap to metadata in MeshActionHandlerImpl); passkey is captured from the response.
   */
  async ensureSessionKey(destNodeNum: number): Promise<void> {
    if (this.sessionStore.get(destNodeNum)) return;
    await this.getRemoteMetadata(destNodeNum, {
      timeoutMs: REMOTE_ADMIN_SESSION_KEY_TIMEOUT_MS,
    });
  }

  async getRemoteMetadata(
    destNodeNum: number,
    sendOptions?: RemoteAdminSendOptions,
  ): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getDeviceMetadataRequest', value: true },
        }),
      {
        ...REMOTE_ADMIN_READ_SEND_OPTIONS,
        ...sendOptions,
        expectedResponseCases: ['getDeviceMetadataResponse'],
      },
    );
    if (response.payloadVariant.case !== 'getDeviceMetadataResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async getRemoteConfig(
    destNodeNum: number,
    configType: (typeof Admin.AdminMessage_ConfigType)[keyof typeof Admin.AdminMessage_ConfigType],
    sendOptions?: RemoteAdminSendOptions,
  ): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getConfigRequest', value: configType },
        }),
      {
        ...REMOTE_ADMIN_READ_SEND_OPTIONS,
        ...sendOptions,
        expectedResponseCases: ['getConfigResponse'],
      },
    );
    const responseCase = response.payloadVariant.case;
    if (responseCase !== 'getConfigResponse') {
      console.warn(
        '[MeshtasticRemoteAdmin] unexpected getConfigResponse variant configType=' +
          String(configType) +
          ' case=' +
          (responseCase ?? 'unknown'),
      );
      throw new Error('remoteAdmin.errors.configResponseUnexpected');
    }
    return response.payloadVariant.value;
  }

  async getRemoteConfigWithRetry(
    destNodeNum: number,
    configType: (typeof Admin.AdminMessage_ConfigType)[keyof typeof Admin.AdminMessage_ConfigType],
    options?: {
      maxAttempts?: number;
      backoffMs?: number;
      sendOptions?: RemoteAdminSendOptions;
    },
  ): Promise<unknown> {
    const sendOptions = options?.sendOptions;
    return retryRemoteAdminOp(() => this.getRemoteConfig(destNodeNum, configType, sendOptions), {
      maxAttempts: options?.maxAttempts ?? REMOTE_ADMIN_LORA_CONFIG_MAX_ATTEMPTS,
      backoffMs: options?.backoffMs ?? REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS,
    });
  }

  async getRemoteModuleConfig(
    destNodeNum: number,
    moduleType: (typeof Admin.AdminMessage_ModuleConfigType)[keyof typeof Admin.AdminMessage_ModuleConfigType],
  ): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getModuleConfigRequest', value: moduleType },
        }),
      {
        ...REMOTE_ADMIN_READ_SEND_OPTIONS,
        expectedResponseCases: ['getModuleConfigResponse'],
      },
    );
    if (response.payloadVariant.case !== 'getModuleConfigResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async getRemoteChannel(
    destNodeNum: number,
    index: number,
    sendOptions?: RemoteAdminSendOptions,
  ): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          // Meshtastic firmware/admin protobuf expects get_channel_request to be 1-based.
          payloadVariant: { case: 'getChannelRequest', value: index + 1 },
        }),
      {
        ...REMOTE_ADMIN_READ_SEND_OPTIONS,
        ...sendOptions,
        expectedResponseCases: ['getChannelResponse'],
      },
    );
    const responseCase = response.payloadVariant.case;
    if (responseCase !== 'getChannelResponse') {
      console.warn(
        '[MeshtasticRemoteAdmin] unexpected getChannelResponse variant index=' +
          String(index) +
          ' case=' +
          (responseCase ?? 'unknown'),
      );
      throw new Error('remoteAdmin.errors.channelResponseUnexpected');
    }
    return response.payloadVariant.value;
  }

  async getRemoteChannelWithRetry(
    destNodeNum: number,
    index: number,
    options?: {
      maxAttempts?: number;
      backoffMs?: number;
      sendOptions?: RemoteAdminSendOptions;
    },
  ): Promise<unknown> {
    const sendOptions = options?.sendOptions;
    return retryRemoteAdminOp(() => this.getRemoteChannel(destNodeNum, index, sendOptions), {
      maxAttempts: options?.maxAttempts ?? REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS,
      backoffMs: options?.backoffMs ?? REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS,
      isRetryable: (message) =>
        isRemoteAdminRetryableError(message) ||
        message === 'remoteAdmin.errors.channelResponseUnexpected',
    });
  }

  async getRemoteOwner(destNodeNum: number): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getOwnerRequest', value: true },
        }),
      {
        ...REMOTE_ADMIN_READ_SEND_OPTIONS,
        expectedResponseCases: ['getOwnerResponse'],
      },
    );
    if (response.payloadVariant.case !== 'getOwnerResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async beginRemoteEdit(destNodeNum: number): Promise<void> {
    if (this.pendingEdit) return;
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'beginEditSettings', value: true },
        }),
      { wantResponse: false, requireSession: true },
    );
    this.pendingEdit = true;
  }

  async setRemoteConfig(destNodeNum: number, config: unknown): Promise<void> {
    await this.beginRemoteEdit(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setConfig', value: config as never },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async setRemoteModuleConfig(destNodeNum: number, moduleConfig: unknown): Promise<void> {
    await this.beginRemoteEdit(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setModuleConfig', value: moduleConfig as never },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async setRemoteChannel(destNodeNum: number, channel: unknown): Promise<void> {
    await this.beginRemoteEdit(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setChannel', value: channel as never },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async setRemoteOwner(destNodeNum: number, owner: unknown): Promise<void> {
    await this.beginRemoteEdit(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setOwner', value: owner as never },
        }),
      { wantResponse: false, requireSession: true },
    );
    await this.commitRemoteEdit(destNodeNum);
  }

  async commitRemoteEdit(destNodeNum: number): Promise<void> {
    try {
      await this.ensureSessionKey(destNodeNum);
      await this.sendAdminRequest(
        destNodeNum,
        () =>
          adminMessage({
            payloadVariant: { case: 'commitEditSettings', value: true },
          }),
        { wantResponse: false, requireSession: true },
      );
    } finally {
      this.pendingEdit = false;
    }
  }

  async remoteReboot(destNodeNum: number, seconds: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'rebootSeconds', value: seconds },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async remoteShutdown(destNodeNum: number, seconds: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'shutdownSeconds', value: seconds },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async remoteFactoryResetDevice(destNodeNum: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'factoryResetDevice', value: true },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async remoteFactoryResetConfig(destNodeNum: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'factoryResetConfig', value: true },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async remoteResetNodeDb(destNodeNum: number, preserveFavorites: boolean): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'nodedbReset', value: preserveFavorites },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async setRemoteRingtone(destNodeNum: number, ringtone: string): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setRingtoneMessage', value: ringtone },
        }),
      { wantResponse: false, requireSession: true },
    );
  }

  async setRemoteCannedMessages(destNodeNum: number, messages: string): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'setCannedMessageModuleMessages', value: messages },
        }),
      { wantResponse: false, requireSession: true },
    );
  }
}
