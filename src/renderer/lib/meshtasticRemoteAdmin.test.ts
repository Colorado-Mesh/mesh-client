import { create, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRemoteAdminToRadio,
  extractAdminSessionPasskey,
  MeshtasticRemoteAdminClient,
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

  it('resolves pending admin responses from the target node', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(sendRaw).toHaveBeenCalledTimes(1);

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
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.5.0');
    expect(client.sessionStore.get(0x200)).toEqual(new Uint8Array(8).fill(7));
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
