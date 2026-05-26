import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeToRadioWithoutQueue } from './meshtasticBacklogUtils';
import {
  buildRemoteAdminToRadio,
  computeRemoteAdminRadioLoadingWatchdogMs,
  createSerialTaskQueue,
  extractAdminSessionPasskey,
  meshtasticNodePublicKeyBytesFromHex,
  MeshtasticRemoteAdminClient,
  normalizeRemoteAdminError,
  parseIncomingRemoteAdminPacket,
  REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS,
  REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS,
  REMOTE_ADMIN_MODULES_LOADING_WATCHDOG_MS,
  REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS,
  REMOTE_ADMIN_RESPONSE_TIMEOUT_MS,
  REMOTE_ADMIN_SECURITY_LOADING_WATCHDOG_MS,
  REMOTE_ADMIN_SESSION_ACTIVE_MS,
  REMOTE_ADMIN_SESSION_TTL_MS,
  RemoteAdminSessionStore,
  remoteConfigLoadingWatchdogMsForRoute,
  resolveMeshtasticDestPublicKeyBytes,
  routingErrorToRemoteAdminKey,
} from './meshtasticRemoteAdmin';
import { parseMeshtasticAdminKeyBase64 } from './meshtasticRemoteAdminKeyStorage';

vi.mock('./meshtasticBacklogUtils', () => ({
  writeToRadioWithoutQueue: vi.fn(),
}));

const TEST_DEST_PUBKEY_HEX = '4852b69364572b52efa1b6bb3e6d0abed4f389a1cbfbb60a9bba2cce649caf0e';
const TEST_DEST_PUBKEY = meshtasticNodePublicKeyBytesFromHex(TEST_DEST_PUBKEY_HEX)!;

describe('resolveMeshtasticDestPublicKeyBytes', () => {
  const adminKeyB64 = btoa(String.fromCharCode(...TEST_DEST_PUBKEY));

  it('prefers mesh NodeDB hex over stored admin key', () => {
    const wrong = new Uint8Array(32).fill(9);
    const wrongHex = [...wrong].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(
      resolveMeshtasticDestPublicKeyBytes({
        publicKeyHex: TEST_DEST_PUBKEY_HEX,
        adminKeyBase64: btoa(String.fromCharCode(...wrong)),
      }),
    ).toEqual(TEST_DEST_PUBKEY);
    expect(
      resolveMeshtasticDestPublicKeyBytes({
        publicKeyHex: wrongHex,
        adminKeyBase64: adminKeyB64,
      }),
    ).toEqual(wrong);
  });

  it('falls back to stored admin key when mesh hex is missing', () => {
    expect(
      resolveMeshtasticDestPublicKeyBytes({
        adminKeyBase64: adminKeyB64,
      }),
    ).toEqual(TEST_DEST_PUBKEY);
    expect(parseMeshtasticAdminKeyBase64(adminKeyB64)).toEqual(TEST_DEST_PUBKEY);
  });
});

describe('meshtasticNodePublicKeyBytesFromHex', () => {
  it('parses a 32-byte hex public key', () => {
    expect(meshtasticNodePublicKeyBytesFromHex(TEST_DEST_PUBKEY_HEX)).toEqual(TEST_DEST_PUBKEY);
  });

  it('rejects invalid hex lengths', () => {
    expect(meshtasticNodePublicKeyBytesFromHex('abcd')).toBeUndefined();
    expect(meshtasticNodePublicKeyBytesFromHex(undefined)).toBeUndefined();
  });
});

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

  it('reports active vs stale session status', () => {
    vi.useFakeTimers();
    const store = new RemoteAdminSessionStore();
    const now = Date.now();
    store.set(1, new Uint8Array(8).fill(1));
    expect(store.getStatus(1, now)).toBe('active');
    vi.advanceTimersByTime(REMOTE_ADMIN_SESSION_ACTIVE_MS + 1);
    expect(store.getStatus(1)).toBe('stale');
    vi.advanceTimersByTime(REMOTE_ADMIN_SESSION_TTL_MS);
    expect(store.getStatus(1)).toBe('none');
    vi.useRealTimers();
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

  it('prefers Data.replyId over mesh packet id for multi-hop responses', () => {
    const adminMsg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'getChannelResponse', value: { index: 0 } as never },
    });
    const meshPacket = create(Mesh.MeshPacketSchema, {
      id: 9999,
      from: 0x200,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.ADMIN_APP,
          payload: toBinary(Admin.AdminMessageSchema, adminMsg),
          requestId: 0,
          replyId: 4242,
        },
      },
    });

    const parsed = parseIncomingRemoteAdminPacket(meshPacket as never);
    expect(parsed).toMatchObject({ kind: 'admin', requestId: 4242, from: 0x200 });
  });

  it('falls back to mesh packet id when Data.requestId is zero and sole pending matches from', () => {
    const adminMsg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'getDeviceMetadataResponse', value: {} as never },
    });
    const meshPacket = create(Mesh.MeshPacketSchema, {
      id: 7777,
      from: 0x200,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.ADMIN_APP,
          payload: toBinary(Admin.AdminMessageSchema, adminMsg),
          requestId: 0,
        },
      },
    });
    const pending = new Map([
      [
        555,
        {
          destNodeNum: 0x200,
          packetId: 555,
          timeoutMs: 120_000,
          createdAt: Date.now(),
          resolve: () => {},
          reject: () => {},
          timeoutId: setTimeout(() => {}, 0),
        },
      ],
    ]);
    const firstPending = pending.values().next().value;
    if (firstPending?.timeoutId) {
      clearTimeout(firstPending.timeoutId);
    }

    const parsed = parseIncomingRemoteAdminPacket(meshPacket as never, {
      pending,
    });
    expect(parsed).toMatchObject({ kind: 'admin', requestId: 7777, from: 0x200 });
  });

  it('does not fall back to mesh packet id without sole pending context', () => {
    const adminMsg = create(Admin.AdminMessageSchema, {
      payloadVariant: { case: 'getDeviceMetadataResponse', value: {} as never },
    });
    const meshPacket = create(Mesh.MeshPacketSchema, {
      id: 7777,
      from: 0x200,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.ADMIN_APP,
          payload: toBinary(Admin.AdminMessageSchema, adminMsg),
          requestId: 0,
        },
      },
    });

    const parsed = parseIncomingRemoteAdminPacket(meshPacket as never);
    expect(parsed).toMatchObject({ kind: 'admin', requestId: 0, from: 0x200 });
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

/** Returns true when `fieldNumber` appears as a top-level field on the protobuf wire. */
function wireHasProtoField(wire: Uint8Array, fieldNumber: number): boolean {
  let offset = 0;
  while (offset < wire.length) {
    let tag = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = wire[offset++];
      tag |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    const field = tag >>> 3;
    const wireType = tag & 0x7;
    if (field === fieldNumber) return true;
    if (wireType === 0) {
      do {
        byte = wire[offset++];
      } while (byte & 0x80);
    } else if (wireType === 2) {
      let len = 0;
      shift = 0;
      do {
        byte = wire[offset++];
        len |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      offset += len;
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return false;
}

describe('buildRemoteAdminToRadio', () => {
  it('sets pkiEncrypted and publicKey; omits channel field on wire for PKI admin', () => {
    const adminPayload = new Uint8Array([1, 2, 3]);
    const bytes = buildRemoteAdminToRadio({
      myNodeNum: 0x100,
      destNodeNum: 0x200,
      adminPayload,
      packetId: 99,
      publicKey: TEST_DEST_PUBKEY,
    });
    expect(bytes.length).toBeGreaterThan(0);

    const toRadio = fromBinary(Mesh.ToRadioSchema, bytes) as {
      payloadVariant?: {
        case?: string;
        value?: {
          pkiEncrypted?: boolean;
          publicKey?: Uint8Array;
          channel?: number;
          hopLimit?: number;
          hopStart?: number;
        };
      };
    };
    expect(toRadio.payloadVariant?.case).toBe('packet');
    const packet = toRadio.payloadVariant?.value;
    expect(packet?.pkiEncrypted).toBe(true);
    expect(packet?.publicKey).toEqual(TEST_DEST_PUBKEY);
    expect(packet).toBeDefined();
    const packetWire = toBinary(Mesh.MeshPacketSchema, packet as never);
    expect(wireHasProtoField(packetWire, 5)).toBe(false);
    expect(packet?.channel ?? 0).toBe(0);
    expect(packet?.hopLimit).toBe(7);
    expect(packet?.hopStart).toBe(7);
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
    expect(routingErrorToRemoteAdminKey(Mesh.Routing_Error.NO_CHANNEL)).toBe(
      'remoteAdmin.errors.timeout',
    );
  });
});

describe('buildRemoteAdminToRadio', () => {
  it('encodes wantAck false when requested for read-only admin', () => {
    const bytes = buildRemoteAdminToRadio({
      myNodeNum: 0x100,
      destNodeNum: 0x200,
      adminPayload: new Uint8Array([1, 2, 3]),
      packetId: 42,
      publicKey: TEST_DEST_PUBKEY,
      wantAck: false,
    });
    const toRadio = fromBinary(Mesh.ToRadioSchema, bytes) as {
      payloadVariant?: { case?: string; value?: { wantAck?: boolean } };
    };
    expect(toRadio.payloadVariant?.case).toBe('packet');
    if (toRadio.payloadVariant?.case === 'packet') {
      expect(toRadio.payloadVariant.value?.wantAck).toBe(false);
    }
  });
});

describe('MeshtasticRemoteAdminClient', () => {
  let packetIdSeq: number;
  let device: { generateRandId: () => number };
  let client: MeshtasticRemoteAdminClient;

  beforeEach(() => {
    packetIdSeq = 555;
    vi.mocked(writeToRadioWithoutQueue).mockReset();
    vi.mocked(writeToRadioWithoutQueue).mockResolvedValue(undefined);
    device = {
      generateRandId: () => packetIdSeq++,
    };
    client = new MeshtasticRemoteAdminClient(
      () => device as never,
      () => 0x100,
      () => TEST_DEST_PUBKEY,
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
    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(1);
    const packetId = 555;

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

  it('rejects when destination public key is missing', async () => {
    const noKeyClient = new MeshtasticRemoteAdminClient(
      () => device as never,
      () => 0x100,
      () => undefined,
    );
    try {
      await expect(noKeyClient.getRemoteMetadata(0x200)).rejects.toThrow(
        'remoteAdmin.errors.pkiFailed',
      );
      expect(writeToRadioWithoutQueue).not.toHaveBeenCalled();
    } finally {
      noKeyClient.dispose();
    }
  });

  it('serializes writes so the second request waits for the first to finish sending', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.mocked(writeToRadioWithoutQueue)
      .mockImplementationOnce(() => firstGate)
      .mockResolvedValue(undefined);

    packetIdSeq = 2000;

    const firstPromise = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
    const secondPromise = client.getRemoteConfig(
      0x200,
      Admin.AdminMessage_ConfigType.DEVICE_CONFIG,
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(1);

    releaseFirst!();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(2);

    const loraPacketId = 2000;
    const devicePacketId = 2001;

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
                  case: 'getConfigResponse',
                  value: {
                    payloadVariant: { case: 'lora', value: { region: 1 } },
                  } as never,
                },
              }),
            ),
            requestId: loraPacketId,
          },
        },
      }) as never,
    );
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
                  case: 'getConfigResponse',
                  value: {
                    payloadVariant: { case: 'device', value: { role: 0 } },
                  } as never,
                },
              }),
            ),
            requestId: devicePacketId,
          },
        },
      }) as never,
    );

    const [loraResult, deviceResult] = await Promise.all([firstPromise, secondPromise]);
    expect((loraResult as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe(
      'lora',
    );
    expect((deviceResult as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe(
      'device',
    );
  });

  it('resolves admin responses correlated by Data.replyId when mesh packet id differs', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const requestPacketId = 555;

    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: 8888,
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
                  value: { firmwareVersion: '2.7.0' } as never,
                },
              }),
            ),
            requestId: 0,
            replyId: requestPacketId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.7.0');
  });

  it('resolves admin responses correlated by mesh packet id when requestId is zero', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;

    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: packetId,
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
                  value: { firmwareVersion: '2.6.0' } as never,
                },
              }),
            ),
            requestId: 0,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.6.0');
  });

  it('resetEditState clears pendingEdit so a new target can begin edits', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    client.sessionStore.set(0x300, new Uint8Array(8).fill(2));
    await client.beginRemoteEdit(0x200);
    client.resetEditState();
    await client.beginRemoteEdit(0x300);
    expect(writeToRadioWithoutQueue).toHaveBeenCalled();
  });

  it('commitRemoteEdit clears pendingEdit when commit fails', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    await client.beginRemoteEdit(0x200);
    const callsAfterBegin = vi.mocked(writeToRadioWithoutQueue).mock.calls.length;
    vi.mocked(writeToRadioWithoutQueue).mockRejectedValueOnce(new Error('transport failed'));
    await expect(client.commitRemoteEdit(0x200)).rejects.toThrow('transport failed');
    vi.mocked(writeToRadioWithoutQueue).mockResolvedValue(undefined);
    await client.beginRemoteEdit(0x200);
    expect(vi.mocked(writeToRadioWithoutQueue).mock.calls.length).toBeGreaterThan(callsAfterBegin);
  });

  it('resolves metadata when admin response has from=0 (Linux BLE quirk)', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;

    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(
              Admin.AdminMessageSchema,
              create(Admin.AdminMessageSchema, {
                sessionPasskey: new Uint8Array(8).fill(9),
                payloadVariant: {
                  case: 'getDeviceMetadataResponse',
                  value: { firmwareVersion: '2.5.1' } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { firmwareVersion?: string }).firmwareVersion).toBe('2.5.1');
    expect(client.sessionStore.get(0x200)).toEqual(new Uint8Array(8).fill(9));
    expect(client.sessionStore.get(0)).toBeUndefined();
  });

  it('ignores admin responses from an unexpected non-zero node', async () => {
    vi.useFakeTimers();
    try {
      const promise = client.sendAdminRequest(
        0x200,
        () =>
          create(Admin.AdminMessageSchema, {
            payloadVariant: { case: 'getDeviceMetadataRequest', value: true },
          }) as never,
        { expectedResponseCases: ['getDeviceMetadataResponse'], timeoutMs: 50 },
      );
      await Promise.resolve();
      const packetId = 555;

      client.handleMeshPacket(
        create(Mesh.MeshPacketSchema, {
          from: 0x300,
          payloadVariant: {
            case: 'decoded',
            value: {
              portnum: Portnums.PortNum.ADMIN_APP,
              payload: toBinary(
                Admin.AdminMessageSchema,
                create(Admin.AdminMessageSchema, {
                  payloadVariant: {
                    case: 'getDeviceMetadataResponse',
                    value: { firmwareVersion: '9.9.9' } as never,
                  },
                }),
              ),
              requestId: packetId,
            },
          },
        }) as never,
      );

      const rejection = expect(promise).rejects.toThrow('remoteAdmin.errors.timeout');
      await vi.advanceTimersByTimeAsync(50);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects and clears pending when write fails with SDK-shaped error object', async () => {
    vi.mocked(writeToRadioWithoutQueue).mockRejectedValueOnce({
      id: 718745655,
      error: Mesh.Routing_Error.ADMIN_PUBLIC_KEY_UNAUTHORIZED,
    });
    await expect(client.getRemoteMetadata(0x200)).rejects.toThrow(
      'remoteAdmin.errors.publicKeyUnauthorized',
    );

    vi.mocked(writeToRadioWithoutQueue).mockResolvedValue(undefined);
    packetIdSeq = 900;
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 900;
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
    const packetId = 555;
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

  it('ignores ROUTING with requestId zero when multiple admin requests are pending', async () => {
    const rejections: unknown[] = [];
    const promiseLora = client
      .getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG)
      .catch((e: unknown) => {
        rejections.push(e);
        throw e;
      });
    const promiseDevice = client
      .getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.DEVICE_CONFIG)
      .catch((e: unknown) => {
        rejections.push(e);
        throw e;
      });
    await vi.waitFor(() => {
      expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(2);
    });

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
            requestId: 0,
          },
        },
      }) as never,
    );

    expect(rejections).toHaveLength(0);

    const loraResponse = create(Admin.AdminMessageSchema, {
      payloadVariant: {
        case: 'getConfigResponse',
        value: { payloadVariant: { case: 'lora', value: { region: 1 } } } as never,
      },
    });
    const deviceResponse = create(Admin.AdminMessageSchema, {
      payloadVariant: {
        case: 'getConfigResponse',
        value: { payloadVariant: { case: 'device', value: {} } } as never,
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
            requestId: 555,
          },
        },
      }) as never,
    );
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        from: 0x200,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(Admin.AdminMessageSchema, deviceResponse),
            requestId: 556,
          },
        },
      }) as never,
    );

    await Promise.all([promiseLora, promiseDevice]);
  });

  it('correlates ROUTING to sole pending when requestId is zero', async () => {
    vi.useFakeTimers();
    try {
      const promise = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
      await Promise.resolve();
      const packetId = 555;

      client.handleMeshPacket(
        create(Mesh.MeshPacketSchema, {
          id: packetId,
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
                    value: Mesh.Routing_Error.NO_RESPONSE,
                  },
                }),
              ),
              requestId: 0,
            },
          },
        }) as never,
      );

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
                    case: 'getConfigResponse',
                    value: { payloadVariant: { case: 'lora', value: { region: 1 } } } as never,
                  },
                }),
              ),
              requestId: packetId,
            },
          },
        }) as never,
      );

      const result = await promise;
      expect((result as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe('lora');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects on fatal ROUTING when mesh packet id matches', async () => {
    const promise = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: packetId,
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
            requestId: 0,
          },
        },
      }) as never,
    );
    await expect(promise).rejects.toThrow('remoteAdmin.errors.pkiFailed');
  });

  it('retries getRemoteConfig after retryable routing errors', async () => {
    vi.useFakeTimers();
    try {
      packetIdSeq = 800;
      const promise = client.getRemoteConfigWithRetry(
        0x200,
        Admin.AdminMessage_ConfigType.LORA_CONFIG,
        { maxAttempts: 2, backoffMs: 500 },
      );
      await Promise.resolve();
      const firstPacketId = 800;

      client.handleMeshPacket(
        create(Mesh.MeshPacketSchema, {
          id: firstPacketId,
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
                    value: Mesh.Routing_Error.ADMIN_BAD_SESSION_KEY,
                  },
                }),
              ),
              requestId: 0,
            },
          },
        }) as never,
      );

      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const secondPacketId = 801;

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
                    case: 'getConfigResponse',
                    value: {
                      payloadVariant: { case: 'lora', value: { region: 2 } },
                    } as never,
                  },
                }),
              ),
              requestId: secondPacketId,
            },
          },
        }) as never,
      );

      const result = await promise;
      expect((result as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe('lora');
      expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends wantAck false on read-only getRemoteMetadata', async () => {
    const promise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(1);
    const toRadioBytes = vi.mocked(writeToRadioWithoutQueue).mock.calls[0][1];
    const toRadio = fromBinary(Mesh.ToRadioSchema, toRadioBytes) as {
      payloadVariant?: { case?: string; value?: { wantAck?: boolean } };
    };
    expect(toRadio.payloadVariant?.case).toBe('packet');
    if (toRadio.payloadVariant?.case === 'packet') {
      expect(toRadio.payloadVariant.value?.wantAck).toBe(false);
    }

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
            requestId: 555,
          },
        },
      }) as never,
    );
    await promise;
  });

  it('ignores benign ROUTING_APP errors while waiting for getChannelResponse', async () => {
    const promise = client.getRemoteChannel(0x200, 0);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;

    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: packetId,
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
                  value: Mesh.Routing_Error.NO_CHANNEL,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

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
                  case: 'getChannelResponse',
                  value: {
                    index: 0,
                    role: 1,
                    settings: { name: 'Primary', psk: new Uint8Array([1]) },
                  } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { settings?: { name?: string } }).settings?.name).toBe('Primary');
  });

  it('retries getRemoteChannel after retryable errors', async () => {
    vi.useFakeTimers();
    try {
      packetIdSeq = 900;
      const promise = client.getRemoteChannelWithRetry(0x200, 0, {
        maxAttempts: 2,
        backoffMs: 500,
      });
      await Promise.resolve();
      const firstPacketId = 900;

      client.handleMeshPacket(
        create(Mesh.MeshPacketSchema, {
          id: firstPacketId,
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
                    value: Mesh.Routing_Error.ADMIN_BAD_SESSION_KEY,
                  },
                }),
              ),
              requestId: 0,
            },
          },
        }) as never,
      );

      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const secondPacketId = 901;

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
                    case: 'getChannelResponse',
                    value: {
                      index: 0,
                      role: 1,
                      settings: { name: 'Primary', psk: new Uint8Array([1]) },
                    } as never,
                  },
                }),
              ),
              requestId: secondPacketId,
            },
          },
        }) as never,
      );

      const result = await promise;
      expect((result as { settings?: { name?: string } }).settings?.name).toBe('Primary');
      expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects getRemoteChannel when admin response case does not match expected channel case', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    const promise = client.getRemoteChannel(0x200, 0);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;

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
                  case: 'getConfigResponse',
                  value: { payloadVariant: { case: 'lora', value: {} } } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

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
                  case: 'getChannelResponse',
                  value: {
                    index: 0,
                    role: 1,
                    settings: { name: 'Primary', psk: new Uint8Array([1]) },
                  } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { settings?: { name?: string } }).settings?.name).toBe('Primary');
  });

  it('ignores stale metadata ADMIN_APP while waiting for getChannelResponse', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    const promise = client.getRemoteChannel(0x200, 0);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const channelPacketId = 555;

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
            requestId: channelPacketId,
          },
        },
      }) as never,
    );

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
                  case: 'getChannelResponse',
                  value: {
                    index: 0,
                    role: 1,
                    settings: { name: 'LongFast', psk: new Uint8Array([1]) },
                  } as never,
                },
              }),
            ),
            requestId: channelPacketId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { settings?: { name?: string } }).settings?.name).toBe('LongFast');
  });

  it('ignores tombstoned duplicate ADMIN_APP for a resolved request id', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    const metadataPromise = client.getRemoteMetadata(0x200);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const metadataPacketId = 555;

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
            requestId: metadataPacketId,
          },
        },
      }) as never,
    );
    await metadataPromise;

    const channelPromise = client.getRemoteChannel(0x200, 0);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const channelPacketId = 556;

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
            requestId: metadataPacketId,
          },
        },
      }) as never,
    );

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
                  case: 'getChannelResponse',
                  value: {
                    index: 0,
                    role: 1,
                    settings: { name: 'LongFast', psk: new Uint8Array([1]) },
                  } as never,
                },
              }),
            ),
            requestId: channelPacketId,
          },
        },
      }) as never,
    );

    const result = await channelPromise;
    expect((result as { settings?: { name?: string } }).settings?.name).toBe('LongFast');
  });

  it('ignores mesh packet id fallback from wrong pending count', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    const promiseLora = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
    const promiseDevice = client.getRemoteConfig(
      0x200,
      Admin.AdminMessage_ConfigType.DEVICE_CONFIG,
    );
    await vi.waitFor(() => {
      expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(2);
    });

    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: 9999,
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
            requestId: 0,
          },
        },
      }) as never,
    );

    expect(client.sessionStore.get(0x200)).toEqual(new Uint8Array(8).fill(1));
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
                  case: 'getConfigResponse',
                  value: {
                    payloadVariant: { case: 'lora', value: { region: 1 } },
                  } as never,
                },
              }),
            ),
            requestId: 555,
          },
        },
      }) as never,
    );
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
                  case: 'getConfigResponse',
                  value: {
                    payloadVariant: { case: 'device', value: {} },
                  } as never,
                },
              }),
            ),
            requestId: 556,
          },
        },
      }) as never,
    );
    await Promise.all([promiseLora, promiseDevice]);
  });

  it('ignores stale metadata ADMIN_APP while waiting for getConfigResponse', async () => {
    client.sessionStore.set(0x200, new Uint8Array(8).fill(1));
    const promise = client.getRemoteConfig(0x200, Admin.AdminMessage_ConfigType.LORA_CONFIG);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const packetId = 555;

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
                  case: 'getConfigResponse',
                  value: { payloadVariant: { case: 'lora', value: {} } } as never,
                },
              }),
            ),
            requestId: packetId,
          },
        },
      }) as never,
    );

    const result = await promise;
    expect((result as { payloadVariant?: { case?: string } }).payloadVariant?.case).toBe('lora');
  });

  it('ensureSessionKey bootstraps via getDeviceMetadata when no passkey is cached', async () => {
    const dest = 0x200;
    const promise = client.ensureSessionKey(dest);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeToRadioWithoutQueue).mock.calls[0][1];
    const decoded = fromBinary(Mesh.ToRadioSchema, written) as {
      payloadVariant?: {
        case?: string;
        value?: {
          payloadVariant?: { case?: string; value?: { payload?: Uint8Array } };
        };
      };
    };
    const adminPayload = decoded.payloadVariant?.value?.payloadVariant?.value?.payload;
    const adminMsg = fromBinary(Admin.AdminMessageSchema, adminPayload!) as {
      payloadVariant?: { case?: string };
    };
    expect(adminMsg.payloadVariant?.case).toBe('getDeviceMetadataRequest');

    const packetId = 555;
    client.handleMeshPacket(
      create(Mesh.MeshPacketSchema, {
        id: packetId,
        from: dest,
        payloadVariant: {
          case: 'decoded',
          value: {
            portnum: Portnums.PortNum.ADMIN_APP,
            payload: toBinary(
              Admin.AdminMessageSchema,
              create(Admin.AdminMessageSchema, {
                sessionPasskey: new Uint8Array(8).fill(3),
                payloadVariant: { case: 'getDeviceMetadataResponse', value: {} as never },
              }),
            ),
            requestId: 0,
          },
        },
      }) as never,
    );

    await promise;
    expect(client.sessionStore.get(dest)).toHaveLength(8);
    await client.ensureSessionKey(dest);
    expect(writeToRadioWithoutQueue).toHaveBeenCalledTimes(1);
  });
});

describe('remoteConfigLoadingWatchdogMsForRoute', () => {
  it('radio watchdog covers channel 0 worst-case retries', () => {
    const channel0WorstMs =
      REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS * REMOTE_ADMIN_RESPONSE_TIMEOUT_MS +
      (REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS - 1) * REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS;
    expect(computeRemoteAdminRadioLoadingWatchdogMs()).toBe(REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS);
    expect(remoteConfigLoadingWatchdogMsForRoute('radio')).toBeGreaterThanOrEqual(channel0WorstMs);
  });

  it('uses longer watchdogs for radio, security, and modules routes', () => {
    expect(remoteConfigLoadingWatchdogMsForRoute('radio')).toBe(
      REMOTE_ADMIN_RADIO_LOADING_WATCHDOG_MS,
    );
    expect(remoteConfigLoadingWatchdogMsForRoute('radio')).toBeGreaterThanOrEqual(60_000);
    expect(remoteConfigLoadingWatchdogMsForRoute('security')).toBe(
      REMOTE_ADMIN_SECURITY_LOADING_WATCHDOG_MS,
    );
    expect(remoteConfigLoadingWatchdogMsForRoute('modules')).toBe(
      REMOTE_ADMIN_MODULES_LOADING_WATCHDOG_MS,
    );
    expect(remoteConfigLoadingWatchdogMsForRoute('modules')).toBeGreaterThanOrEqual(120_000);
  });
});

describe('createSerialTaskQueue', () => {
  it('runs tasks one at a time in order', async () => {
    const queue = createSerialTaskQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const second = queue.enqueue(() => {
      order.push('second');
      return Promise.resolve();
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    releaseFirst?.();
    await first;
    await second;
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
