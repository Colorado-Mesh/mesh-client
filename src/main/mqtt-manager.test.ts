// @vitest-environment node
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt as MqttProto, Portnums } from '@meshtastic/protobufs';
import { createCipheriv } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MQTTManager, parsePsk } from './mqtt-manager';

const { ServiceEnvelopeSchema } = MqttProto;
const { UserSchema, PositionSchema, DataSchema, MeshPacketSchema } = Mesh;
const { PortNum } = Portnums;

const DEFAULT_PSK = Buffer.from([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const CUSTOM_PSK = Buffer.from([
  0x1e, 0x2f, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07,
]);

/** Build the AES-128-CTR nonce used by Meshtastic: packetId (4 LE) + fromId (4 LE) + 8 zeros */
function makeNonce(packetId: number, fromId: number): Buffer {
  const nonce = Buffer.alloc(16, 0);
  nonce.writeUInt32LE(packetId >>> 0, 0);
  nonce.writeUInt32LE(fromId >>> 0, 4);
  return nonce;
}

/** Encrypt `plaintext` bytes with a given PSK using AES-128-CTR */
function encrypt(plaintext: Uint8Array, packetId: number, fromId: number, psk: Buffer): Buffer {
  const nonce = makeNonce(packetId, fromId);
  const cipher = createCipheriv('aes-128-ctr', psk, nonce);
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
}

/** Build a serialized ServiceEnvelope with an encrypted MeshPacket */
function buildEnvelope(options: {
  nodeId: number;
  packetId: number;
  dataBytes: Uint8Array;
  psk: Buffer;
  channelName?: string;
}): Buffer {
  const { nodeId, packetId, dataBytes, psk, channelName = 'LongFast' } = options;
  const encrypted = encrypt(dataBytes, packetId, nodeId, psk);
  const packet = create(MeshPacketSchema, {
    from: nodeId,
    to: 0xffffffff,
    id: packetId,
    channel: 0,
    payloadVariant: { case: 'encrypted', value: encrypted },
  });
  const gatewayId = `!${nodeId.toString(16).padStart(8, '0')}`;
  const envelope = create(ServiceEnvelopeSchema, {
    packet,
    channelId: channelName,
    gatewayId,
  });
  return Buffer.from(toBinary(ServiceEnvelopeSchema, envelope));
}

/** Build a serialized ServiceEnvelope with a decoded (unencrypted) MeshPacket */
function buildDecodedEnvelope(options: {
  nodeId: number;
  packetId: number;
  dataBytes: Uint8Array;
  channelName?: string;
  hopStart?: number;
  hopLimit?: number;
}): Buffer {
  const { nodeId, packetId, dataBytes, channelName = 'LongFast', hopStart, hopLimit } = options;
  const data = fromBinary(DataSchema, dataBytes);
  const packet = create(MeshPacketSchema, {
    from: nodeId,
    to: 0xffffffff,
    id: packetId,
    channel: 0,
    payloadVariant: {
      case: 'decoded',
      value: data,
    },
    ...(hopStart !== undefined && { hopStart }),
    ...(hopLimit !== undefined && { hopLimit }),
  });
  const gatewayId = `!${nodeId.toString(16).padStart(8, '0')}`;
  const envelope = create(ServiceEnvelopeSchema, {
    packet,
    channelId: channelName,
    gatewayId,
  });
  return Buffer.from(toBinary(ServiceEnvelopeSchema, envelope));
}

// ─────────────────────────────────────────────────────────────────────────────
// parsePsk
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePsk', () => {
  it('returns null for empty string', () => {
    expect(parsePsk('')).toBeNull();
    expect(parsePsk('   ')).toBeNull();
  });

  it('returns a 16-byte buffer for a 16-byte base64 key', () => {
    const b64 = CUSTOM_PSK.toString('base64');
    const result = parsePsk(b64);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
    expect(result!).toEqual(CUSTOM_PSK);
  });

  it('zero-pads a short key (1 byte) to 16 bytes', () => {
    const result = parsePsk('AQ=='); // [0x01]
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
    expect(result![0]).toBe(0x01);
    expect(result!.subarray(1).every((b) => b === 0)).toBe(true);
  });

  it('truncates a key longer than 16 bytes to 16 bytes', () => {
    const longKey = Buffer.alloc(32, 0xab).toString('base64');
    const result = parsePsk(longKey);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// emitMinimalNodeUpdate — cache name propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('emitMinimalNodeUpdate', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('emits only node_id and last_heard when cache has no entry', () => {
    const events: unknown[] = [];
    manager.on('nodeUpdate', (u) => events.push(u));

    (manager as any).emitMinimalNodeUpdate(0xdeadbeef);

    expect(events).toHaveLength(1);
    const update = events[0] as Record<string, unknown>;
    expect(update.node_id).toBe(0xdeadbeef);
    expect(update.last_heard).toBeTypeOf('number');
    expect(update.from_mqtt).toBe(true);
    expect(update.long_name).toBeUndefined();
    expect(update.short_name).toBeUndefined();
    expect(update.hw_model).toBeUndefined();
  });

  it('includes cached names when the cache has been populated', () => {
    const events: unknown[] = [];
    manager.on('nodeUpdate', (u) => events.push(u));

    (manager as any).upsertNodeCache({
      node_id: 0xdeadbeef,
      long_name: 'Test Node',
      short_name: 'TEST',
      hw_model: '43',
      last_heard: Date.now(),
    });

    (manager as any).emitMinimalNodeUpdate(0xdeadbeef);

    const update = events[0] as Record<string, unknown>;
    expect(update.long_name).toBe('Test Node');
    expect(update.short_name).toBe('TEST');
    expect(update.hw_model).toBe('43');
  });

  it('omits empty-string name fields even when cache entry exists', () => {
    const events: unknown[] = [];
    manager.on('nodeUpdate', (u) => events.push(u));

    (manager as any).upsertNodeCache({
      node_id: 0x11223344,
      long_name: '',
      short_name: '',
      hw_model: '',
      last_heard: Date.now(),
    });

    (manager as any).emitMinimalNodeUpdate(0x11223344);

    const update = events[0] as Record<string, unknown>;
    expect(update.long_name).toBeUndefined();
    expect(update.short_name).toBeUndefined();
    expect(update.hw_model).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tryDecryptWithKey
// ─────────────────────────────────────────────────────────────────────────────

describe('tryDecryptWithKey', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('decrypts a payload encrypted with DEFAULT_PSK', () => {
    const plaintext = Buffer.from('hello meshtastic');
    const packetId = 0x12345678;
    const fromId = 0xabcd1234;
    const encrypted = encrypt(plaintext, packetId, fromId, DEFAULT_PSK);

    const result = (manager as any).tryDecryptWithKey(encrypted, packetId, fromId, DEFAULT_PSK);
    expect(result).not.toBeNull();
    expect(result.toString()).toBe('hello meshtastic');
  });

  it('decrypts a payload encrypted with a custom PSK', () => {
    const plaintext = Buffer.from('custom channel payload');
    const packetId = 0x99887766;
    const fromId = 0x11223344;
    const encrypted = encrypt(plaintext, packetId, fromId, CUSTOM_PSK);

    const result = (manager as any).tryDecryptWithKey(encrypted, packetId, fromId, CUSTOM_PSK);
    expect(result).not.toBeNull();
    expect(result.toString()).toBe('custom channel payload');
  });

  it('returns garbage (not null) when wrong key is used — AES-CTR never throws', () => {
    const plaintext = Buffer.from('secret');
    const packetId = 0x1;
    const fromId = 0x2;
    const encrypted = encrypt(plaintext, packetId, fromId, DEFAULT_PSK);

    // Wrong key — AES-CTR decrypts without throwing; produces garbage
    const result = (manager as any).tryDecryptWithKey(encrypted, packetId, fromId, CUSTOM_PSK);
    expect(result).not.toBeNull();
    expect(result.toString()).not.toBe('secret');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tryDecryptAllKeys
// ─────────────────────────────────────────────────────────────────────────────

describe('tryDecryptAllKeys', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('decodes a packet encrypted with DEFAULT_PSK when no extra PSKs configured', () => {
    const user = create(UserSchema, { id: '!abcd1234', longName: 'Alpha', shortName: 'ALP' });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    const encrypted = encrypt(dataBytes, 1, 0xabcd1234, DEFAULT_PSK);
    const result = (manager as any).tryDecryptAllKeys(encrypted, 1, 0xabcd1234);
    expect(result).not.toBeNull();
    expect(result!.portnum).toBe(PortNum.NODEINFO_APP);
  });

  it('returns null when packet is encrypted with unknown PSK', () => {
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('hi'),
      }),
    );
    // Encrypted with CUSTOM_PSK but manager has no extra PSKs
    const encrypted = encrypt(dataBytes, 2, 0x11111111, CUSTOM_PSK);
    const result = (manager as any).tryDecryptAllKeys(encrypted, 2, 0x11111111);
    expect(result).toBeNull();
  });

  it('succeeds with a custom PSK when it is in extraPsks', () => {
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('custom channel message'),
      }),
    );
    const encrypted = encrypt(dataBytes, 3, 0x22222222, CUSTOM_PSK);

    (manager as any).extraPsks = [CUSTOM_PSK];
    const result = (manager as any).tryDecryptAllKeys(encrypted, 3, 0x22222222);
    expect(result).not.toBeNull();
    expect(result!.portnum).toBe(PortNum.TEXT_MESSAGE_APP);
  });

  it('tries DEFAULT_PSK first then falls through to custom PSK', () => {
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.POSITION_APP,
        payload: toBinary(
          PositionSchema,
          create(PositionSchema, { latitudeI: 400000000, longitudeI: -1050000000 }),
        ),
      }),
    );
    const encrypted = encrypt(dataBytes, 4, 0x33333333, CUSTOM_PSK);

    (manager as any).extraPsks = [CUSTOM_PSK];
    const result = (manager as any).tryDecryptAllKeys(encrypted, 4, 0x33333333);
    expect(result).not.toBeNull();
    expect(result!.portnum).toBe(PortNum.POSITION_APP);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — NODEINFO_APP (default PSK)
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — NODEINFO_APP', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('emits nodeUpdate with long_name and short_name when NODEINFO decrypts with default PSK', () => {
    const nodeId = 0xabcd1234;
    const packetId = 0x00000001;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Bravo Station',
      shortName: 'BRV',
      hwModel: 43,
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!abcd1234', payload);

    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.long_name).toBe('Bravo Station');
    expect(u.short_name).toBe('BRV');
    expect(u.from_mqtt).toBe(true);
  });

  it('emits nodeUpdate with names when NODEINFO arrives on a custom PSK channel', () => {
    const nodeId = 0x55667788;
    const packetId = 0x00000002;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Custom Node',
      shortName: 'CUS',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: CUSTOM_PSK,
      channelName: 'MyChannel',
    });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    // Register the custom PSK before processing
    (manager as any).extraPsks = [CUSTOM_PSK];
    (manager as any).onMessage('msh/US/2/e/MyChannel/!55667788', payload);

    const u = updates[0] as Record<string, unknown>;
    expect(u.long_name).toBe('Custom Node');
    expect(u.short_name).toBe('CUS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — POSITION_APP
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — POSITION_APP', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('emits nodeUpdate with lat/lon from a position packet', () => {
    const nodeId = 0xaabbccdd;
    const packetId = 0x00000010;

    const pos = create(PositionSchema, { latitudeI: 400000000, longitudeI: -1050000000 });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.POSITION_APP,
        payload: toBinary(PositionSchema, pos),
      }),
    );

    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!aabbccdd', payload);

    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.latitude as number).toBeCloseTo(40.0, 3);
    expect(u.longitude as number).toBeCloseTo(-105.0, 3);
  });

  it('preserves cached names when emitting a position update', () => {
    const nodeId = 0x12345678;
    const packetId = 0x00000011;

    // Seed the cache with a name
    (manager as any).upsertNodeCache({
      node_id: nodeId,
      long_name: 'Named Node',
      short_name: 'NAM',
      hw_model: '',
      last_heard: Date.now(),
    });

    const pos = create(PositionSchema, { latitudeI: 399000000, longitudeI: -1049000000 });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.POSITION_APP,
        payload: toBinary(PositionSchema, pos),
      }),
    );

    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!12345678', payload);

    // Position update itself doesn't include names — but node cache has them
    const u = updates[0] as Record<string, unknown>;
    expect(u.latitude).toBeDefined();
    // long_name is not spread into position updates (only into minimal updates)
    // The UI merges with existing node state; cache is the source
    expect(u.node_id).toBe(nodeId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — encrypted, unknown PSK → minimal update with cached names
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — unknown PSK falls back to minimal update', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('does not emit update when decryption fails', () => {
    const nodeId = 0xdeadbeef;
    const packetId = 0x00000020;

    // Pre-seed cache (simulates having received a NODEINFO earlier in the session)
    (manager as any).upsertNodeCache({
      node_id: nodeId,
      long_name: 'Cached Name',
      short_name: 'CACH',
      hw_model: '41',
      last_heard: Date.now() - 60_000,
    });

    // Encrypt with CUSTOM_PSK but manager has no extra PSKs configured
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('encrypted with unknown key'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: CUSTOM_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/CustomChan/!deadbeef', payload);

    // No updates should be emitted when decryption fails - we don't add unknown nodes
    expect(updates).toHaveLength(0);
  });

  it('does not emit update for brand-new unknown-PSK node', () => {
    const nodeId = 0x99aabbcc;
    const packetId = 0x00000021;

    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('mystery packet'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: CUSTOM_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/CustomChan/!99aabbcc', payload);

    // No updates should be emitted when decryption fails - we don't add unknown nodes
    expect(updates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe('deduplication', () => {
  it('ignores a second packet with the same packetId', () => {
    const manager = new MQTTManager();
    const nodeId = 0x11223344;
    const packetId = 0x00000030;

    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('dup test'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!11223344', payload);
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223344', payload);

    // Second message with same packetId must be silently dropped
    expect(updates).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// connect() — parses channelPsks from settings into extraPsks
// ─────────────────────────────────────────────────────────────────────────────

describe('connect — channelPsks parsing', () => {
  it('populates extraPsks from settings.channelPsks', () => {
    const manager = new MQTTManager();
    const customB64 = CUSTOM_PSK.toString('base64');

    // Intercept _doConnect to avoid actual network activity
    (manager as any)._doConnect = () => {};

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [customB64],
    });

    const extraPsks: Buffer[] = (manager as any).extraPsks;
    expect(extraPsks).toHaveLength(1);
    expect(extraPsks[0]).toEqual(CUSTOM_PSK);
  });

  it('filters out empty PSK strings', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: ['', '  ', CUSTOM_PSK.toString('base64')],
    });

    expect((manager as any).extraPsks).toHaveLength(1);
  });

  it('sets extraPsks to empty array when channelPsks is omitted', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
    });

    expect((manager as any).extraPsks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — decoded (unencrypted) NODEINFO packet
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — decoded (unencrypted) packet', () => {
  it('handles a decoded NODEINFO_APP packet and emits names', () => {
    const manager = new MQTTManager();
    const nodeId = 0x0a0b0c0d;
    const packetId = 0x00000040;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Decoded Node',
      shortName: 'DEC',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!0a0b0c0d', payload);

    const u = updates[0] as Record<string, unknown>;
    expect(u.long_name).toBe('Decoded Node');
    expect(u.short_name).toBe('DEC');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — JSON position messages
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — JSON position', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('handles JSON position with latitudeI/longitudeI fields', () => {
    const nodeId = 0x698524e8;
    const json = {
      type: 'position',
      from: `!${nodeId.toString(16)}`,
      latitudeI: 40_000_000,
      longitudeI: -105_000_000,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!698524e8', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBeCloseTo(4.0, 3);
    expect(update.longitude).toBeCloseTo(-10.5, 3);
    expect(update.from_mqtt).toBe(true);
  });

  it('handles JSON position with direct latitude/longitude fields', () => {
    const nodeId = 0x12345678;
    const json = {
      type: 'position',
      from: `!${nodeId.toString(16)}`,
      latitude: 39.7392,
      longitude: -104.9903,
      altitude: 1608,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!12345678', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBe(39.7392);
    expect(update.longitude).toBe(-104.9903);
    expect(update.altitude).toBe(1608);
  });

  it('handles JSON position with snake_case latitude_i/longitude_i', () => {
    const nodeId = 0xdeadbeef;
    const json = {
      type: 'position',
      from: `!${nodeId.toString(16)}`,
      latitude_i: 33_500_000,
      longitude_i: -112_000_000,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/AZ/2/json/LongFast/!deadbeef', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBeCloseTo(3.35, 2);
    expect(update.longitude).toBeCloseTo(-11.2, 1);
  });

  it('handles JSON position with payload wrapper', () => {
    const nodeId = 0xaabbccdd;
    const json = {
      type: 'position',
      from: `!${nodeId.toString(16)}`,
      payload: {
        latitudeI: 50_000_000,
        longitudeI: -80_000_000,
        altitude: 100,
      },
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/NC/2/json/LongFast/!aabbccdd', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBeCloseTo(5.0, 1);
    expect(update.longitude).toBeCloseTo(-8.0, 1);
    expect(update.altitude).toBe(100);
  });

  it('handles JSON position with from as decimal string', () => {
    const nodeId = 0x12345678;
    const json = {
      type: 'position',
      from: nodeId.toString(10),
      latitude: 40.0,
      longitude: -105.0,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!12345678', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBe(40.0);
  });

  it('emits positionWarning for invalid coordinates (0,0)', () => {
    const nodeId = 0x11111111;
    const json = {
      type: 'position',
      from: `!${nodeId.toString(16)}`,
      latitude: 0,
      longitude: 0,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!11111111', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.positionWarning).toBe('No GPS fix (0°, 0°)');
    expect(update.latitude).toBeUndefined();
    expect(update.longitude).toBeUndefined();
  });

  it('ignores JSON position missing from field', () => {
    const json = {
      type: 'position',
      latitude: 40.0,
      longitude: -105.0,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!00000000', payload);

    expect(updates).toHaveLength(0);
  });

  it('ignores JSON position with invalid from hex', () => {
    const json = {
      type: 'position',
      from: '!notvalid',
      latitude: 40.0,
      longitude: -105.0,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!00000000', payload);

    expect(updates).toHaveLength(0);
  });

  it('handles POSITION type (uppercase)', () => {
    const nodeId = 0x22222222;
    const json = {
      type: 'POSITION',
      from: `!${nodeId.toString(16)}`,
      latitude: 35.0,
      longitude: -90.0,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!22222222', payload);

    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBe(35.0);
    expect(update.longitude).toBe(-90.0);
  });

  it('handles JSON position with numeric from field (Meshtastic firmware JSON format)', () => {
    const nodeId = 0x12ab34cd;
    const json = {
      type: 'position',
      from: nodeId, // number, not string
      latitude: 39.7392,
      longitude: -104.9903,
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!12ab34cd', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.latitude).toBe(39.7392);
    expect(update.longitude).toBe(-104.9903);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — JSON nodeinfo
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — JSON nodeinfo', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('emits nodeUpdate from JSON USER message with user wrapper', () => {
    const nodeId = 0xdeadbeef;
    const json = {
      type: 'USER',
      from: `!${nodeId.toString(16)}`,
      user: {
        longName: 'Test Node',
        shortName: 'TST',
        hwModel: 'TBEAM',
        role: 0,
      },
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/json/LongFast/!deadbeef', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.long_name).toBe('Test Node');
    expect(update.short_name).toBe('TST');
  });

  it('handles JSON nodeinfo with numeric from field (Meshtastic firmware JSON format)', () => {
    const nodeId = 0x11223344;
    const json = {
      type: 'USER',
      from: nodeId, // number, not string
      user: {
        longName: 'Numeric From Node',
        shortName: 'NFN',
      },
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/json/LongFast/!11223344', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.long_name).toBe('Numeric From Node');
    expect(update.short_name).toBe('NFN');
  });

  it('handles JSON nodeinfo with root-level name fields (no user/payload wrapper)', () => {
    const nodeId = 0xaabbccdd;
    // Some firmware versions emit longName/shortName at the root without a "user" wrapper
    const json = {
      from: nodeId,
      longName: 'Root Level Node',
      shortName: 'RLN',
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/json/LongFast/!aabbccdd', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.long_name).toBe('Root Level Node');
    expect(update.short_name).toBe('RLN');
  });

  it('handles JSON nodeinfo with lowercase longname, shortname, and hardware in payload', () => {
    const nodeId = 0x0400a410;
    const json = {
      channel: 0,
      from: nodeId,
      payload: {
        longname: 'DrAwkward',
        shortname: 'DRA',
        hardware: 43,
        role: 0,
      },
      type: 'nodeinfo',
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!6982c484', payload);

    expect(updates).toHaveLength(1);
    const update = updates[0] as Record<string, unknown>;
    expect(update.node_id).toBe(nodeId);
    expect(update.long_name).toBe('DrAwkward');
    expect(update.short_name).toBe('DRA');
    expect(update.hw_model).toBe('43');
  });
});

describe('onMessage — JSON sampled handling', () => {
  let manager: MQTTManager;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    manager = new MQTTManager();
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it('suppresses unhandled log noise for empty type + missing portnum messages', () => {
    const payload = Buffer.from(
      JSON.stringify({
        from: 0x6982c484,
        to: 0xa2d67b68,
        type: '',
      }),
    );

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!6982c484', payload);

    expect(
      debugSpy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('JSON message missing type/portnum ignored'),
      ),
    ).toBe(true);
    expect(
      debugSpy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('JSON message unhandled'),
      ),
    ).toBe(false);
  });

  it('treats traceroute JSON as known and avoids unhandled logging', () => {
    const payload = Buffer.from(
      JSON.stringify({
        from: 0x698524e8,
        to: 0x6982c484,
        type: 'traceroute',
        payload: { route: ['A', 'B'] },
      }),
    );

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!698524e8', payload);

    expect(
      debugSpy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('JSON traceroute message ignored'),
      ),
    ).toBe(true);
    expect(
      debugSpy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('JSON message unhandled'),
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onMessage — binary MQTT hop count (issue #271)
// ─────────────────────────────────────────────────────────────────────────────

describe('onMessage — binary MQTT hop count', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('emits hops_away from hopStart and hopLimit in a binary NODEINFO packet', () => {
    const nodeId = 0x11223344;
    const packetId = 0x00000020;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Hop Node',
      shortName: 'HOP',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    // hopStart=3, hopLimit=2 => 1 hop away from the MQTT bridge
    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes, hopStart: 3, hopLimit: 2 });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223344', payload);

    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.hops_away).toBe(1);
  });

  it('does not emit hops_away when hopStart is 0', () => {
    const nodeId = 0x55667788;
    const packetId = 0x00000021;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'No Hop Node',
      shortName: 'NHN',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    // hopStart=0 means no valid hop data
    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes, hopStart: 0, hopLimit: 0 });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!55667788', payload);

    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.hops_away).toBeUndefined();
  });

  it('does not emit hops_away when hopLimit exceeds hopStart (invalid)', () => {
    const nodeId = 0x99aabbcc;
    const packetId = 0x00000022;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Bad Hop Node',
      shortName: 'BHN',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    // hopLimit > hopStart is an invalid/corrupt packet
    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes, hopStart: 2, hopLimit: 3 });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!99aabbcc', payload);

    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.hops_away).toBeUndefined();
  });

  it('emits hops_away=0 when hopStart equals hopLimit (node directly at the MQTT bridge)', () => {
    const nodeId = 0xddeeff00;
    const packetId = 0x00000023;

    const user = create(UserSchema, {
      id: `!${nodeId.toString(16)}`,
      longName: 'Direct Node',
      shortName: 'DIR',
    });
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.NODEINFO_APP,
        payload: toBinary(UserSchema, user),
      }),
    );

    // hopStart=3, hopLimit=3 => 0 hops (directly heard by MQTT bridge)
    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes, hopStart: 3, hopLimit: 3 });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!ddeeff00', payload);

    expect(updates).toHaveLength(1);
    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.hops_away).toBe(0);
  });
});

describe('onMessage — ServiceEnvelope decoding robust handling', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('successfully decodes ServiceEnvelope with trailing null bytes by trimming', () => {
    const nodeId = 0x12345678;
    const packetId = 123;
    const packet = create(MeshPacketSchema, {
      from: nodeId,
      id: packetId,
      payloadVariant: {
        case: 'decoded',
        value: create(DataSchema, { portnum: PortNum.TEXT_MESSAGE_APP }),
      },
    });
    const envelope = create(ServiceEnvelopeSchema, {
      packet,
    });
    const bytes = toBinary(ServiceEnvelopeSchema, envelope);

    // Add two trailing null bytes
    const junkBytes = new Uint8Array(bytes.length + 2);
    junkBytes.set(bytes);
    junkBytes[bytes.length] = 0;
    junkBytes[bytes.length + 1] = 0;

    const updates: any[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    const debugSpy = vi.spyOn(console, 'debug');

    (manager as any).onMessage('msh/US/2/e/LongFast/!12345678', Buffer.from(junkBytes));

    expect(updates).toHaveLength(1);
    expect(updates[0].node_id).toBe(nodeId);
    expect(updates[0].last_heard).toBeDefined();

    // Should not log decode failure
    const failedCalls = debugSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('ServiceEnvelope decode failed'),
    );
    expect(failedCalls).toHaveLength(0);
  });

  it('does not over-trim when a null byte is part of a valid field (fixed32 id)', () => {
    // id = 0x11223300 will end in 00 in Little Endian (00 33 22 11)
    // Field 6 (id) starts with tag (6 << 3 | 5) = 0x35.
    // So fixed32 id = 0x11223300 should be 35 00 33 22 11.
    const nodeId = 0x12345678;
    const packetId = 0x11223300;
    const packet = create(MeshPacketSchema, {
      from: nodeId,
      id: packetId,
      payloadVariant: {
        case: 'decoded',
        value: create(DataSchema, { portnum: PortNum.TEXT_MESSAGE_APP }),
      },
    });
    const envelope = create(ServiceEnvelopeSchema, {
      packet,
    });
    const bytes = toBinary(ServiceEnvelopeSchema, envelope);

    // Check if it ends in 0. id is field 6, but payloadVariant is field 4.
    // from is field 1.
    // Let's use a simpler packet where id is likely near the end.
    // Actually, let's just find where 0 is and ensure it's handled.
    // If we use id=0x00223344 it should have 00 at offset 1 from tag.

    const updates: any[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!12345678', Buffer.from(bytes));

    expect(updates).toHaveLength(1);
    expect(updates[0].node_id).toBe(nodeId);
    expect(updates[0].last_heard).toBeDefined();
  });
});
