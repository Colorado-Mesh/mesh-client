import { create, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRemoteAdminToRadio,
  extractAdminSessionPasskey,
  MeshtasticRemoteAdminClient,
  normalizeRemoteAdminError,
  parseIncomingRemoteAdminPacket,
  REMOTE_ADMIN_SESSION_TTL_MS,
  RemoteAdminSessionStore,
  routingErrorToRemoteAdminKey,
} from './meshtasticRemoteAdmin';

describe('RemoteAdminSessionStore', () => {
  it('stores and returns an 8-byte passkey before expiry', () => {
    const store = new RemoteAdminSessionStore();
    const passkey = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    store.set(0x12345678, passkey);
    expect(store.get(0x12345678)).toEqual(passkey);
  });

  it('expires passkeys after TTL', () => {
    vi.useFakeTimers();
    const store = new RemoteAdminSessionStore();
    store.set(1, new Uint8Array(8).fill(9));
    vi.advanceTimersByTime(REMOTE_ADMIN_SESSION_TTL_MS + 1);
    expect(store.get(1)).toBeUndefined();
    vi.useRealTimers();
  });

  it('ignores invalid passkey lengths', () => {
    const store = new RemoteAdminSessionStore();
    store.set(1, new Uint8Array(4));
    expect(store.get(1)).toBeUndefined();
  });
});

describe('parseIncomingRemoteAdminPacket', () => {
  it('parses ADMIN_APP responses and session passkeys', () => {
    const adminMsg = create(Admin.AdminMessageSchema, {
      sessionPasskey: new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
      payloadVariant: { case: 'getDeviceMetadataResponse', value: {} as never },
    });
    const payload = toBinary(Admin.AdminMessageSchema, adminMsg);
    const meshPacket = create(Mesh.MeshPacketSchema, {
      from: 0xabcdef01,
      to: 0x11111111,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.ADMIN_APP,
          payload,
        },
      },
    });

    const parsed = parseIncomingRemoteAdminPacket(meshPacket as never);
    expect(parsed?.kind).toBe('admin');
    if (parsed?.kind === 'admin') {
      expect(parsed.from).toBe(0xabcdef01);
      expect(extractAdminSessionPasskey(parsed.message)).toEqual(
        new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
      );
    }
  });

  it('parses ROUTING_APP errors by request id', () => {
    const routingPayload = toBinary(
      Mesh.RoutingSchema,
      create(Mesh.RoutingSchema, {
        variant: {
          case: 'errorReason',
          value: Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED,
        },
      }),
    );
    const meshPacket = create(Mesh.MeshPacketSchema, {
      from: 0xabcdef01,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.ROUTING_APP,
          payload: routingPayload,
          requestId: 4242,
        },
      },
    });

    const parsed = parseIncomingRemoteAdminPacket(meshPacket as never);
    expect(parsed).toEqual({
      kind: 'routing_error',
      error: Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED,
      requestId: 4242,
      from: 0xabcdef01,
    });
  });
});

describe('buildRemoteAdminToRadio', () => {
  it('sets pkiEncrypted and ADMIN_APP payload', () => {
    const adminPayload = new Uint8Array([1, 2, 3]);
    const bytes = buildRemoteAdminToRadio({
      myNodeNum: 0x100,
      destNodeNum: 0x200,
      adminPayload,
      packetId: 99,
    });
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });
});

describe('normalizeRemoteAdminError', () => {
  it('maps SDK queue error objects with numeric error codes', () => {
    expect(
      normalizeRemoteAdminError({
        id: 718745655,
        error: Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED,
      }),
    ).toBe('remoteAdmin.errors.publicKeyUnauthorized');
  });

  it('maps SDK queue error objects with string error names', () => {
    expect(
      normalizeRemoteAdminError({
        id: 1,
        error: 'ADMIN_PUBLIC_KEY_UNAUTHORIZED',
      }),
    ).toBe('remoteAdmin.errors.publicKeyUnauthorized');
  });

  it('preserves existing i18n keys on Error instances', () => {
    expect(normalizeRemoteAdminError(new Error('remoteAdmin.errors.badSessionKey'))).toBe(
      'remoteAdmin.errors.badSessionKey',
    );
  });
});

describe('routingErrorToRemoteAdminKey', () => {
  it('maps admin-specific routing errors', () => {
    expect(routingErrorToRemoteAdminKey(Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED)).toBe(
      'remoteAdmin.errors.publicKeyUnauthorized',
    );
    expect(routingErrorToRemoteAdminKey(Mesh.Routing_Error.ADMIN_BAD_SESSION_KEY)).toBe(
      'remoteAdmin.errors.badSessionKey',
    );
  });
});

describe('MeshtasticRemoteAdminClient', () => {
  let sendRaw: ReturnType<typeof vi.fn>;
  let device: { sendRaw: typeof sendRaw; generateRandId: () => number };
  let client: MeshtasticRemoteAdminClient;

  beforeEach(() => {
    sendRaw = vi.fn((_bytes: Uint8Array, id: number) => id);
    device = {
      sendRaw,
      generateRandId: () => 555,
    };
    client = new MeshtasticRemoteAdminClient(
      () => device as never,
      () => 0x100,
    );
  });

  afterEach(() => {
    client.dispose();
  });

  it('resolves pending admin responses from the target node by request id', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(sendRaw).toHaveBeenCalledTimes(1);
    const packetId = sendRaw.mock.calls[0]?.[1] as number;

    const response = create(Admin.AdminMessageSchema, {
      sessionPasskey: new Uint8Array(8).fill(7),
      payloadVariant: {
        case: 'getDeviceMetadataResponse',
        value: { firmwareVersion: '2.5.0' } as never,
      },
    });
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(Admin.AdminMessageSchema, response),
            requestId: packetId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.5.0');
    expect(client.sessionStore.get(0x200)).toEqual(new Uint8Array(8).fill(7));
  });

  it('correlates concurrent getRemoteConfig responses by request id', async () => {
    let nextId = 1000;
    sendRaw.mockImplementation((_bytes: Uint8Array, id: number) => id);
    device.generateRandId = () => nextId++;

    const loraPromise = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
    const devicePromise = client.getRemoteConfig(
      0x200,
      Admin.AdminMessage_ConfigType.DEVICE_CONFIG,
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const loraPacketId = sendRaw.mock.calls[0]?.[1] as number;
    const devicePacketId = sendRaw.mock.calls[1]?.[1] as number;

    const loraResponse = create(Admin.AdminMessageSchema, {
      payloadVariant: {
        case: 'getConfigResponse',
        value: {
          payloadVariant: { case: 'lora', value: { region: 1 } },
        } as never,
      },
    });
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(Admin.AdminMessageSchema, loraResponse),
            requestId: loraPacketId,
          },
        },
      }) as never,
    );

    const deviceResponse = create(Admin.AdminMessageSchema, {
      payloadVariant: {
        case: 'getConfigResponse',
        value: {
          payloadVariant: { case: 'device', value: { role: 0 } },
        } as never,
      },
    });
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(Admin.AdminMessageSchema, deviceResponse),
            requestId: devicePacketId,
          },
        },
      }) as never,
    );

    const [loraResult, deviceResult] = await Promise.all([loraPromise, devicePromise]);
    expect((loraResult as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe(
      'lora',
    );
    expect((deviceResult as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe(
      'device',
    );
  });

  it('resetEditState clears pendingEdit so a new target can begin edits', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    client.sessionStore.set(0x300, new Uint8Array(8).fill(2));
    await client.beginRemoteEdit(0x200);
    client.resetEditState();
    await client.beginRemoteEdit(0x300);
    expect(sendRaw).toHaveBeenCalled();
  });

  it('commitRemoteEdit clears pendingEdit when commit fails', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    await client.beginRemoteEdit(0x200);
    const callsAfterBegin = sendRaw.mock.calls.length;
    sendRaw.mockImplementation(() => {
      throw new Error('transport failed');
    });
    await expect(client.commitRemoteEdit(0x200)).rejects.toThrow('remoteAdmin.errors.generic');
    sendRaw.mockImplementation((_bytes: Uint8Array, id: number) => id);
    await client.beginRemoteEdit(0x200);
    expect(sendRaw.mock.calls.length).toBeGreaterThan(callsAfterBegin);
  });

  it('rejects and clears pending when sendRaw fails with SDK queue error', async () => {
    sendRaw.mockRejectedValueOnce({
      id: 718745655,
      error: Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED,
    });
    await expect(client.getRemoteMetadata(0x200)).rejects.toThrow(
      'remoteAdmin.errors.publicKeyUnauthorized',
    );

    sendRaw.mockImplementation((_bytes: Uint8Array, id: number) => id);
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = sendRaw.mock.calls.at(-1)?.[1] as number;
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(
              Admin.AdminMessageSchema,
              create(Admin.AdminMessageSchema, {
                payloadVariant: {
                  case: 'getDeviceMetadataResponse',
                  value: { firmwareVersion: '2.5.0' } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );
    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.5.0');
  });

  it('rejects on routing errors correlated to packet id', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = sendRaw.mock.calls[0]?.[1] as number;
    expect(packetId).toBeGreaterThan(0);
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ROUTING_APP,
            payload: toBinary(
              Mesh.RoutingSchema,
              create(Mesh.RoutingSchema, {
                variant: {
                  case: 'errorReason',
                  value: Mesh.Routing_Error.PKI_FAILED,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );
    await expect(promise).rejects.toThrow('remoteAdmin.errors.pkiFailed');
  });
});
