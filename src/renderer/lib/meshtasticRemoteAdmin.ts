import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';

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
}

interface MeshPacket {
  from?: number;
  payloadVariant?: { case?: string; value?: MeshPacketDecoded };
}

/** Firmware session_passkey TTL (AdminModule.cpp). */
export const REMOTE_ADMIN_SESSION_TTL_MS = 300_000;

/** Default wait for multi-hop admin responses. */
export const REMOTE_ADMIN_RESPONSE_TIMEOUT_MS = 120_000;

export type RemoteAdminRoutingErrorCode = number;

export interface RemoteAdminSessionEntry {
  passkey: Uint8Array;
  expiresAt: number;
}

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
  | { kind: 'admin'; message: AdminMessage; from: number }
  | { kind: 'routing_error'; error: RemoteAdminRoutingErrorCode; requestId: number; from: number };

export function extractAdminSessionPasskey(message: AdminMessage): Uint8Array | undefined {
  const key = message.sessionPasskey;
  if (key?.length !== 8) return undefined;
  return key.slice();
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
      return 'remoteAdmin.errors.timeout';
    default:
      return 'remoteAdmin.errors.generic';
  }
}

export function parseIncomingRemoteAdminPacket(meshPacket: MeshPacket): ParsedAdminResponse | null {
  if (meshPacket.payloadVariant?.case !== 'decoded') return null;
  const data = meshPacket.payloadVariant.value;
  if (data == null || meshPacket.from == null) return null;
  const from = meshPacket.from >>> 0;

  if (data.portnum === Portnums.PortNum.ADMIN_APP && (data.payload?.length ?? 0) > 0) {
    try {
      const message = fromBinary(
        Admin.AdminMessageSchema,
        data.payload!,
      ) as unknown as AdminMessage;
      return { kind: 'admin', message, from };
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
        const requestId = (data.requestId ?? 0) >>> 0;
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
  wantAck?: boolean;
  wantResponse?: boolean;
  channel?: number;
}): Uint8Array {
  const meshPacket = create(Mesh.MeshPacketSchema, {
    from: params.myNodeNum >>> 0,
    to: params.destNodeNum >>> 0,
    id: params.packetId >>> 0,
    wantAck: params.wantAck ?? true,
    channel: params.channel ?? 0,
    pkiEncrypted: true,
    payloadVariant: {
      case: 'decoded',
      value: {
        portnum: Portnums.PortNum.ADMIN_APP,
        payload: params.adminPayload,
        wantResponse: params.wantResponse ?? true,
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
  expectedResponseCases?: readonly string[];
  resolve: (value: AdminMessage) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class MeshtasticRemoteAdminClient {
  readonly sessionStore = new RemoteAdminSessionStore();
  private readonly pending = new Map<number, PendingRemoteAdmin>();
  private pendingEdit = false;

  constructor(
    private readonly getDevice: () => MeshDevice | null,
    private readonly getMyNodeNum: () => number,
  ) {}

  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Remote admin client disposed'));
    }
    this.pending.clear();
    this.sessionStore.clear();
    this.pendingEdit = false;
  }

  handleMeshPacket(meshPacket: MeshPacket): void {
    const parsed = parseIncomingRemoteAdminPacket(meshPacket);
    if (!parsed) return;

    if (parsed.kind === 'routing_error') {
      const pending = this.pending.get(parsed.requestId);
      if (!pending) return;
      clearTimeout(pending.timeoutId);
      this.pending.delete(parsed.requestId);
      const key = routingErrorToRemoteAdminKey(parsed.error);
      pending.reject(new Error(key));
      return;
    }

    const passkey = extractAdminSessionPasskey(parsed.message);
    if (passkey) {
      this.sessionStore.set(parsed.from, passkey);
    }

    for (const [packetId, pending] of this.pending.entries()) {
      if (pending.destNodeNum !== parsed.from) continue;
      const responseCase = parsed.message.payloadVariant.case;
      if (!responseCase) continue;
      if (pending.expectedResponseCases && !pending.expectedResponseCases.includes(responseCase)) {
        continue;
      }
      clearTimeout(pending.timeoutId);
      this.pending.delete(packetId);
      pending.resolve(parsed.message);
      return;
    }
  }

  private generatePacketId(): number {
    return Math.floor(Math.random() * 0xffffffff);
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

  private async sendRawAdmin(
    destNodeNum: number,
    message: AdminMessage,
    options: RemoteAdminSendOptions,
  ): Promise<number> {
    const device = this.getDevice();
    const myNodeNum = this.getMyNodeNum();
    if (!device || myNodeNum <= 0) {
      throw new Error('remoteAdmin.errors.noLocalRadio');
    }

    const payload = toBinary(Admin.AdminMessageSchema, message as never);
    const packetId = this.generatePacketId();
    const toRadio = buildRemoteAdminToRadio({
      myNodeNum,
      destNodeNum,
      adminPayload: payload,
      packetId,
      wantAck: options.wantAck ?? true,
      wantResponse: options.wantResponse ?? true,
    });

    return device.sendRaw(toRadio, packetId);
  }

  private waitForAdminResponse(
    destNodeNum: number,
    packetId: number,
    options: RemoteAdminSendOptions,
  ): Promise<AdminMessage> {
    const timeoutMs = options.timeoutMs ?? REMOTE_ADMIN_RESPONSE_TIMEOUT_MS;
    return new Promise<AdminMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(packetId);
        reject(new Error('remoteAdmin.errors.timeout'));
      }, timeoutMs);

      this.pending.set(packetId, {
        destNodeNum: destNodeNum >>> 0,
        packetId,
        expectedResponseCases: options.expectedResponseCases,
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
    const packetId = await this.sendRawAdmin(destNodeNum, message, options);
    if (options.wantResponse === false) {
      return adminMessage({});
    }
    return this.waitForAdminResponse(destNodeNum, packetId, options);
  }

  async ensureSessionKey(destNodeNum: number): Promise<void> {
    if (this.sessionStore.get(destNodeNum)) return;
    await this.getRemoteConfig(destNodeNum, Admin.AdminMessage_ConfigType.SESSIONKEY_CONFIG);
  }

  async getRemoteMetadata(destNodeNum: number): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getDeviceMetadataRequest', value: true },
        }),
      { expectedResponseCases: ['getDeviceMetadataResponse'] },
    );
    if (response.payloadVariant.case !== 'getDeviceMetadataResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async getRemoteConfig(
    destNodeNum: number,
    configType: (typeof Admin.AdminMessage_ConfigType)[keyof typeof Admin.AdminMessage_ConfigType],
  ): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getConfigRequest', value: configType },
        }),
      { expectedResponseCases: ['getConfigResponse'] },
    );
    if (response.payloadVariant.case !== 'getConfigResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
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
      { expectedResponseCases: ['getModuleConfigResponse'] },
    );
    if (response.payloadVariant.case !== 'getModuleConfigResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async getRemoteChannel(destNodeNum: number, index: number): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getChannelRequest', value: index },
        }),
      { expectedResponseCases: ['getChannelResponse'] },
    );
    if (response.payloadVariant.case !== 'getChannelResponse') {
      throw new Error('remoteAdmin.errors.generic');
    }
    return response.payloadVariant.value;
  }

  async getRemoteOwner(destNodeNum: number): Promise<unknown> {
    const response = await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'getOwnerRequest', value: true },
        }),
      { expectedResponseCases: ['getOwnerResponse'] },
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
  }

  async commitRemoteEdit(destNodeNum: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'commitEditSettings', value: true },
        }),
      { wantResponse: false, requireSession: true },
    );
    this.pendingEdit = false;
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

  async remoteResetNodeDb(destNodeNum: number): Promise<void> {
    await this.ensureSessionKey(destNodeNum);
    await this.sendAdminRequest(
      destNodeNum,
      () =>
        adminMessage({
          payloadVariant: { case: 'nodedbReset', value: 1 },
        }),
      { wantResponse: false, requireSession: true },
    );
  }
}
