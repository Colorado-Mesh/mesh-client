// @vitest-environment node
/* eslint-disable no-secrets/no-secrets -- regression fixtures use reporter-shaped base64, not live credentials */
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Mesh, Mqtt as MqttProto, Portnums } from '@meshtastic/protobufs';
import { createCipheriv } from 'crypto';
import * as mqtt from 'mqtt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MQTTSettings } from '../renderer/lib/types';
import { computeMeshtasticChannelHash } from '../shared/meshtasticChannelHash';
import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '../shared/meshtasticDefaultPublicPsk';
import {
  BAD_ENVELOPE_SIGNATURE_MAX,
  bufferListIncludesKey,
  cipherForKey,
  enforceBadEnvelopeSignatureCap,
  MQTTManager,
  parseChannelPskLine,
  parseMeshtasticMqttEncryptedTopicChannelName,
  parseMeshtasticMqttEncryptedTopicGatewayId,
  parseMeshtasticMqttTopicChannelName,
  parsePsk,
  portNumEnumToProtoName,
  prepareMqttProtobufBytes,
} from './mqtt-manager';

vi.mock('mqtt', () => {
  const mockClient = {
    on: vi.fn(),
    end: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    publish: vi.fn(),
    subscribe: vi.fn(),
  };
  return { connect: vi.fn(() => mockClient) };
});

const { ServiceEnvelopeSchema } = MqttProto;
const { UserSchema, PositionSchema, DataSchema, MeshPacketSchema } = Mesh;
const { PortNum } = Portnums;

// The real firmware default channel key (Channels.h `defaultpsk`) — matches production
// MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES / mqtt-manager DEFAULT_PSK, not a hand-copied literal,
// so this fixture can't silently drift from the value parsePsk("AQ==") actually produces.
const DEFAULT_PSK = Buffer.from(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES);

const CUSTOM_PSK = Buffer.from([
  0x1e, 0x2f, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07,
]);

/** Wire a mock, already-connected `mqtt` client + settings onto `manager`; returns the publish spy. */
function wireConnected(manager: MQTTManager): ReturnType<typeof vi.fn> {
  const publish = vi.fn();
  (manager as unknown as { client: unknown }).client = {
    on: vi.fn(),
    end: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: true,
    publish,
    subscribe: vi.fn(),
  };
  (manager as unknown as { currentSettings: MQTTSettings }).currentSettings = {
    server: 'localhost',
    port: 1883,
    username: '',
    password: '',
    topicPrefix: 'msh/US/',
    autoLaunch: false,
  };
  return publish;
}

/** Build the AES-128-CTR nonce used by Meshtastic: packetId (4 LE) + fromId (4 LE) + 8 zeros */
function makeNonce(packetId: number, fromId: number): Buffer {
  const nonce = Buffer.alloc(16, 0);
  nonce.writeUInt32LE(packetId >>> 0, 0);
  nonce.writeUInt32LE(fromId >>> 0, 8);
  return nonce;
}

/** Encrypt `plaintext` bytes with a given PSK using Meshtastic AES-CTR (128 or 256). */
function encrypt(plaintext: Uint8Array, packetId: number, fromId: number, psk: Buffer): Buffer {
  const nonce = makeNonce(packetId, fromId);
  const cipher = createCipheriv(cipherForKey(psk), psk, nonce);
  return Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
}

/** Build a serialized ServiceEnvelope with an encrypted MeshPacket */
function buildEnvelope(options: {
  nodeId: number;
  packetId: number;
  dataBytes: Uint8Array;
  psk: Buffer;
  channelName?: string;
  /** MeshPacket.channel RF slot (0–7) on the wire. */
  channel?: number;
}): Buffer {
  const { nodeId, packetId, dataBytes, psk, channelName = 'LongFast', channel = 0 } = options;
  const encrypted = encrypt(dataBytes, packetId, nodeId, psk);
  const packet = create(MeshPacketSchema, {
    from: nodeId,
    to: 0xffffffff,
    id: packetId,
    channel,
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
  /** MeshPacket.channel RF slot (0–7) on the wire. */
  channel?: number;
  hopStart?: number;
  hopLimit?: number;
}): Buffer {
  const {
    nodeId,
    packetId,
    dataBytes,
    channelName = 'LongFast',
    channel = 0,
    hopStart,
    hopLimit,
  } = options;
  const data = fromBinary(DataSchema, dataBytes);
  const packet = create(MeshPacketSchema, {
    from: nodeId,
    to: 0xffffffff,
    id: packetId,
    channel,
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

describe('prepareMqttProtobufBytes', () => {
  it('strips a leading run of null bytes (broker padding)', () => {
    const core = Buffer.from([0x0a, 0x02, 0xff]);
    const padded = Buffer.concat([Buffer.alloc(4, 0), core]);
    const out = prepareMqttProtobufBytes(padded);
    expect(Array.from(out)).toEqual([0x0a, 0x02, 0xff]);
  });

  it('returns the same view when there is no leading padding', () => {
    const buf = Buffer.from([0x0a, 0x01]);
    const out = prepareMqttProtobufBytes(buf);
    expect(out.byteOffset).toBe(buf.byteOffset);
    expect(out.byteLength).toBe(buf.byteLength);
  });
});

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

  it('expands the default PSK shorthand alias (AQ== / 0x01) to the real firmware key, not zero-padded', () => {
    const result = parsePsk('AQ=='); // [0x01]
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
    expect(result).toEqual(Buffer.from(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES));
  });

  it('expands "simple" preset shorthand aliases (0x02-0x0a) via the default key + offset', () => {
    for (let index = 2; index <= 10; index++) {
      const result = parsePsk(Buffer.from([index]).toString('base64'));
      expect(result).not.toBeNull();
      const expected = Buffer.from(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES);
      expected[15] = (expected[15] + (index - 1)) & 0xff;
      expect(result).toEqual(expected);
    }
  });

  it('zero-pads a 1-byte value outside the defined 0x01-0x0a alias range', () => {
    const result = parsePsk(Buffer.from([200]).toString('base64'));
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16);
    expect(result![0]).toBe(200);
    expect(result!.subarray(1).every((b) => b === 0)).toBe(true);
  });

  it('accepts a 32-byte AES-256 key', () => {
    const longKey = Buffer.alloc(32, 0xab);
    const result = parsePsk(longKey.toString('base64'));
    expect(result).not.toBeNull();
    expect(result!.length).toBe(32);
    expect(result).toEqual(longKey);
  });

  it('rejects invalid lengths between 17 and 31 bytes', () => {
    expect(parsePsk(Buffer.alloc(20, 1).toString('base64'))).toBeNull();
  });
});

describe('cipherForKey', () => {
  it('maps 16-byte keys to aes-128-ctr and 32-byte to aes-256-ctr', () => {
    expect(cipherForKey(Buffer.alloc(16))).toBe('aes-128-ctr');
    expect(cipherForKey(Buffer.alloc(32))).toBe('aes-256-ctr');
  });
});

describe('parseChannelPskLine', () => {
  it('parses ChannelName=base64', () => {
    const b64 = CUSTOM_PSK.toString('base64');
    const parsed = parseChannelPskLine(`HamNet=${b64}`);
    expect(parsed?.name).toBe('HamNet');
    expect(parsed?.psk).toEqual(CUSTOM_PSK);
  });

  it('parses bare base64 with padding equals (not ChannelName=)', () => {
    const b64 = CUSTOM_PSK.toString('base64');
    const parsed = parseChannelPskLine(b64);
    expect(parsed?.name).toBeUndefined();
    expect(parsed?.psk).toEqual(CUSTOM_PSK);
  });

  it('parses ChannelName@index=base64', () => {
    const b64 = CUSTOM_PSK.toString('base64');
    const parsed = parseChannelPskLine(`HamNet@2=${b64}`);
    expect(parsed?.name).toBe('HamNet');
    expect(parsed?.index).toBe(2);
    expect(parsed?.psk).toEqual(CUSTOM_PSK);
  });

  it('parses LongFast@0 reporter key with trailing base64 padding (32-byte AES-256)', () => {
    const line = 'LongFast@0=ZUdhbGNWeThMN2FjcTNwb2wxcnFPRFc0UmJLSFRlY3E=';
    const parsed = parseChannelPskLine(line);
    expect(parsed?.name).toBe('LongFast');
    expect(parsed?.index).toBe(0);
    expect(parsed?.psk?.length).toBe(32);
  });
});

describe('parseMeshtasticMqttEncryptedTopicChannelName', () => {
  it('extracts channel name from encrypted MQTT topic', () => {
    expect(parseMeshtasticMqttEncryptedTopicChannelName('msh/US/2/e/HamNet/!abcd1234')).toBe(
      'HamNet',
    );
  });

  it('handles variable topic prefix depth', () => {
    expect(parseMeshtasticMqttEncryptedTopicChannelName('msh/US/CO/2/e/LongFast/!835bb187')).toBe(
      'LongFast',
    );
  });

  it('returns undefined for JSON topics', () => {
    expect(
      parseMeshtasticMqttEncryptedTopicChannelName('msh/US/CO/2/json/LongFast/!698524e8'),
    ).toBeUndefined();
  });
});

describe('parseMeshtasticMqttTopicChannelName', () => {
  it('extracts channel name from encrypted MQTT topic', () => {
    expect(parseMeshtasticMqttTopicChannelName('msh/US/CO/2/e/LongFast/!835bb187')).toBe(
      'LongFast',
    );
  });

  it('extracts channel name from JSON MQTT topic', () => {
    expect(parseMeshtasticMqttTopicChannelName('msh/US/CO/2/json/Private/!698524e8')).toBe(
      'Private',
    );
  });

  it('returns undefined when topic has no channel segment', () => {
    expect(parseMeshtasticMqttTopicChannelName('msh/US/CO/2/status/!698524e8')).toBeUndefined();
  });
});

describe('parseMeshtasticMqttEncryptedTopicGatewayId', () => {
  it('extracts gateway id from encrypted MQTT topic', () => {
    expect(parseMeshtasticMqttEncryptedTopicGatewayId('msh/US/CO/2/e/LongFast/!835bb187')).toBe(
      '!835bb187',
    );
  });

  it('returns undefined for JSON topics', () => {
    expect(
      parseMeshtasticMqttEncryptedTopicGatewayId('msh/US/CO/2/json/LongFast/!698524e8'),
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// publish — encrypted protobuf + optional JSON mirror
// ─────────────────────────────────────────────────────────────────────────────

describe('publish — MQTT uplink JSON mirror', () => {
  it('publishes only protobuf when publishJsonMirror is false', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    manager.publish({
      text: 'hello',
      from: 0x11223344,
      channel: 0,
      publishJsonMirror: false,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect((publish.mock.calls[0][0] as string).includes('2/e/')).toBe(true);
    expect(
      debugSpy.mock.calls.some((args) =>
        String(args[0]).includes('[Meshtastic MQTT] Publish channel="LongFast"'),
      ),
    ).toBe(true);
    debugSpy.mockRestore();
  });

  it('publishes protobuf and JSON when publishJsonMirror is true', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publish({
      text: 'hello',
      from: 0x11223344,
      channel: 0,
      publishJsonMirror: true,
    });
    expect(publish).toHaveBeenCalledTimes(2);
    const jsonTopic = publish.mock.calls[1][0] as string;
    expect(jsonTopic.includes('2/json/')).toBe(true);
    const body = JSON.parse(publish.mock.calls[1][1] as string) as Record<string, unknown>;
    expect(body.portnum).toBe('TEXT_MESSAGE_APP');
    expect(body.type).toBe('text');
    expect(body.payload).toEqual({ text: 'hello' });
  });

  it('publishWaypoint mirrors WAYPOINT_APP JSON when enabled', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publishWaypoint(
      0x11223344,
      0xffffffff,
      0,
      'LongFast',
      {
        id: 42,
        latitudeI: 450000000,
        longitudeI: -900000000,
        name: 'X',
        description: 'd',
        icon: 0,
        lockedTo: 0,
        expire: 0,
      },
      true,
    );
    expect(publish).toHaveBeenCalledTimes(2);
    const body = JSON.parse(publish.mock.calls[1][1] as string) as Record<string, unknown>;
    expect(body.portnum).toBe('WAYPOINT_APP');
    expect(body.type).toBe('waypoint');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// publishEncryptedData — MeshPacket.channel is the wire hash, not the local slot index
// ─────────────────────────────────────────────────────────────────────────────

describe('publish — MeshPacket.channel wire hash', () => {
  function decodePublishedPacket(publish: ReturnType<typeof vi.fn>, callIndex = 0) {
    const envelope = fromBinary(
      ServiceEnvelopeSchema,
      publish.mock.calls[callIndex][1] as Uint8Array,
    );
    return envelope.packet;
  }

  it('publish() stamps the name+PSK hash, not the local slot index, for the default channel', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publish({
      text: 'hi',
      from: 0x11223344,
      channel: 5, // local slot index — must not leak onto the wire
      channelName: 'LongFast',
      publishJsonMirror: false,
    });
    const packet = decodePublishedPacket(publish);
    expect(packet?.channel).toBe(computeMeshtasticChannelHash('LongFast', DEFAULT_PSK));
    expect(packet?.channel).not.toBe(5);
  });

  it('publish() stamps the name+PSK hash for a custom-PSK channel', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publish({
      text: 'hi',
      from: 0x11223344,
      channel: 1,
      channelName: 'TGIFMESH',
      pskBase64: CUSTOM_PSK.toString('base64'),
      publishJsonMirror: false,
    });
    const packet = decodePublishedPacket(publish);
    expect(packet?.channel).toBe(computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK));
  });

  it('publishNodeInfo() stamps the hash instead of its hardcoded 0', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publishNodeInfo(
      0x11223344,
      'Long Name',
      'LN',
      'TGIFMESH',
      undefined,
      false,
      CUSTOM_PSK.toString('base64'),
    );
    const packet = decodePublishedPacket(publish);
    expect(packet?.channel).toBe(computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK));
  });

  it('publishPosition() and publishWaypoint() also stamp the hash, not the passed slot index', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publishPosition(
      0x11223344,
      3,
      'TGIFMESH',
      450000000,
      -900000000,
      undefined,
      false,
      CUSTOM_PSK.toString('base64'),
    );
    expect(decodePublishedPacket(publish)?.channel).toBe(
      computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK),
    );

    manager.publishWaypoint(
      0x11223344,
      0xffffffff,
      3,
      'TGIFMESH',
      { id: 1, latitudeI: 0, longitudeI: 0, name: 'x' },
      false,
      CUSTOM_PSK.toString('base64'),
    );
    expect(decodePublishedPacket(publish, 1)?.channel).toBe(
      computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK),
    );
  });

  it('JSON mirror channel field matches the same hash as the encrypted packet, not the local slot', () => {
    const manager = new MQTTManager();
    const publish = wireConnected(manager);
    manager.publish({
      text: 'hi',
      from: 0x11223344,
      channel: 4, // local slot index — must not leak into either wire representation
      channelName: 'TGIFMESH',
      pskBase64: CUSTOM_PSK.toString('base64'),
      publishJsonMirror: true,
    });
    expect(publish).toHaveBeenCalledTimes(2);
    const encryptedChannel = decodePublishedPacket(publish, 0)?.channel;
    const jsonBody = JSON.parse(publish.mock.calls[1][1] as string) as Record<string, unknown>;
    const expectedHash = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(encryptedChannel).toBe(expectedHash);
    expect(jsonBody.channel).toBe(expectedHash);
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

  it('includes portnum in event when passed', () => {
    const events: unknown[] = [];
    manager.on('nodeUpdate', (u) => events.push(u));

    (manager as any).emitMinimalNodeUpdate(0xdeadbeef, undefined, PortNum.POSITION_APP);

    const update = events[0] as Record<string, unknown>;
    expect(update.portnum).toBe(PortNum.POSITION_APP);
  });

  it('omits portnum when not passed', () => {
    const events: unknown[] = [];
    manager.on('nodeUpdate', (u) => events.push(u));

    (manager as any).emitMinimalNodeUpdate(0xdeadbeef);

    const update = events[0] as Record<string, unknown>;
    expect(update.portnum).toBeUndefined();
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

  it('decrypts a payload encrypted with AES-256-CTR', () => {
    const aes256 = Buffer.alloc(32, 0x42);
    const plaintext = Buffer.from('ham private net');
    const packetId = 0x55667788;
    const fromId = 0xaabbccdd;
    const encrypted = encrypt(plaintext, packetId, fromId, aes256);

    const result = (manager as any).tryDecryptWithKey(encrypted, packetId, fromId, aes256);
    expect(result).not.toBeNull();
    expect(result.toString()).toBe('ham private net');
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

  it('succeeds with a custom PSK when it is in allDecryptKeys', () => {
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('custom channel message'),
      }),
    );
    const encrypted = encrypt(dataBytes, 3, 0x22222222, CUSTOM_PSK);

    (manager as any).allDecryptKeys = [DEFAULT_PSK, CUSTOM_PSK];
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

    (manager as any).allDecryptKeys = [DEFAULT_PSK, CUSTOM_PSK];
    const result = (manager as any).tryDecryptAllKeys(encrypted, 4, 0x33333333);
    expect(result).not.toBeNull();
    expect(result!.portnum).toBe(PortNum.POSITION_APP);
  });

  it('skips DEFAULT_PSK protobuf false positives and uses the next matching key', () => {
    const fromId = 0x88d3b8b0;
    const publishKey = Buffer.alloc(32, 0xab);
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('echo test'),
      }),
    );

    let falsePositivePacketId: number | undefined;
    for (let attempt = 0; attempt < 20_000; attempt++) {
      const packetId = attempt + 1;
      const encrypted = encrypt(dataBytes, packetId, fromId, publishKey);
      const wrongNonce = makeNonce(packetId, fromId);
      const wrongCipher = createCipheriv(cipherForKey(DEFAULT_PSK), DEFAULT_PSK, wrongNonce);
      const wrongRaw = Buffer.concat([wrongCipher.update(encrypted), wrongCipher.final()]);
      try {
        const candidate = fromBinary(DataSchema, wrongRaw);
        if (candidate.portnum === PortNum.UNKNOWN_APP) {
          falsePositivePacketId = packetId;
          break;
        }
      } catch {
        // keep searching
      }
    }
    expect(falsePositivePacketId).toBeDefined();

    (manager as any).allDecryptKeys = [DEFAULT_PSK, publishKey];
    const encrypted = encrypt(dataBytes, falsePositivePacketId!, fromId, publishKey);
    const result = (manager as any).tryDecryptAllKeys(encrypted, falsePositivePacketId, fromId);
    expect(result).not.toBeNull();
    expect(result!.portnum).toBe(PortNum.TEXT_MESSAGE_APP);
    expect(new TextDecoder().decode(result!.payload)).toBe('echo test');
  });

  it('does not log when all keys fail and topic is provided', () => {
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('secret'),
      }),
    );
    const encrypted = encrypt(dataBytes, 5, 0x44444444, CUSTOM_PSK);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = (manager as any).tryDecryptAllKeys(encrypted, 5, 0x44444444);
    expect(result).toBeNull();
    expect(
      debugSpy.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes('Decrypt failed for topic channel'),
      ),
    ).toBe(false);
    debugSpy.mockRestore();
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
    (manager as any).allDecryptKeys = [DEFAULT_PSK, CUSTOM_PSK];
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

  it('emits portnum=POSITION_APP on minimal update when position has no coordinates', () => {
    const nodeId = 0xaabbccdd;
    const packetId = 0x00000012;

    // Position request: no latitudeI/longitudeI — simulates a node requesting position
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.POSITION_APP,
        payload: toBinary(PositionSchema, create(PositionSchema, {})),
      }),
    );

    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/e/LongFast/!aabbccdd', payload);

    const u = updates[0] as Record<string, unknown>;
    expect(u.node_id).toBe(nodeId);
    expect(u.portnum).toBe(PortNum.POSITION_APP);
    expect(u.latitude).toBeUndefined();
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

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (manager as any).onMessage('msh/US/2/e/CustomChan/!deadbeef', payload);
    debugSpy.mockRestore();

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
// _doConnect — WebSocket scheme selection
// ─────────────────────────────────────────────────────────────────────────────

describe('_doConnect — WebSocket scheme', () => {
  afterEach(() => {
    vi.mocked(mqtt.connect).mockClear();
  });

  it('uses ws:// for port 1883 (plaintext MQTT port, no TLS)', () => {
    new MQTTManager().connect({
      server: 'broker.example.com',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'meshcore',
      autoLaunch: false,
      useWebSocket: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('ws');
  });

  it('uses wss:// for port 443', () => {
    new MQTTManager().connect({
      server: 'mqtt.example.com',
      port: 443,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
      useWebSocket: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('wss');
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { rejectUnauthorized: boolean })
        .rejectUnauthorized,
    ).toBe(true);
  });

  it('honors insecure TLS only when explicitly enabled for wss:// port 443', () => {
    new MQTTManager().connect({
      server: 'mqtt.example.com',
      port: 443,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
      useWebSocket: true,
      tlsInsecure: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('wss');
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { rejectUnauthorized: boolean })
        .rejectUnauthorized,
    ).toBe(false);
  });

  it('uses ws:// when tlsInsecure is true on port 8883', () => {
    new MQTTManager().connect({
      server: 'mqtt.example.com',
      port: 8883,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
      useWebSocket: true,
      tlsInsecure: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('ws');
  });

  it('uses mqtts for native TCP on port 8883', () => {
    new MQTTManager().connect({
      server: 'broker.example.com',
      port: 8883,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('mqtts');
  });

  it('uses mqtt without TLS when tlsEnabled is false on port 8883', () => {
    new MQTTManager().connect({
      server: 'broker.example.com',
      port: 8883,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
      tlsEnabled: false,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('mqtt');
  });

  it('uses mqtts on port 1883 when tlsEnabled is true', () => {
    new MQTTManager().connect({
      server: 'broker.example.com',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh',
      autoLaunch: false,
      tlsEnabled: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('mqtts');
  });

  it('uses wss:// when tlsEnabled is true on port 443', () => {
    new MQTTManager().connect({
      server: 'mqtt.meshcore.coloradomesh.org',
      port: 443,
      username: '',
      password: '',
      topicPrefix: 'meshcore',
      autoLaunch: false,
      useWebSocket: true,
      tlsEnabled: true,
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    expect(
      (vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { protocol: string }).protocol,
    ).toBe('wss');
  });

  it('uses custom wsPath when provided', () => {
    new MQTTManager().connect({
      server: 'mqtt.meshcore.coloradomesh.org',
      port: 443,
      username: '',
      password: '',
      topicPrefix: 'meshcore',
      autoLaunch: false,
      useWebSocket: true,
      tlsEnabled: true,
      wsPath: '/ws',
    });

    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledOnce();
    const opts = vi.mocked(mqtt.connect).mock.calls[0][0] as unknown as { path: string };
    expect(opts.path).toBe('/ws');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// connect() — parses channelPsks from settings into extraPsks
// ─────────────────────────────────────────────────────────────────────────────

describe('connect — channelPsks parsing', () => {
  it('adds unnamed channelPsks to decrypt key set', () => {
    const manager = new MQTTManager();
    const customB64 = CUSTOM_PSK.toString('base64');

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

    const allDecryptKeys: Buffer[] = (manager as any).allDecryptKeys;
    expect(allDecryptKeys.some((k) => k.equals(CUSTOM_PSK))).toBe(true);
  });

  it('maps ChannelName=base64 lines to channelKeysByName', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    const customB64 = CUSTOM_PSK.toString('base64');

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`Private=${customB64}`],
    });

    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.get('Private')?.equals(CUSTOM_PSK)).toBe(true);
  });

  it('maps ChannelName@index=base64 lines to channelNameToIndex', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    const customB64 = CUSTOM_PSK.toString('base64');

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`HamNet@2=${customB64}`],
    });

    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.get('HamNet')).toBe(2);
  });

  it('maps LongFast=base64 without @index to channel 0', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    const customB64 = CUSTOM_PSK.toString('base64');

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`LongFast=${customB64}`],
    });

    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.get('LongFast')).toBe(0);
  });

  it('skips manual lines with invalid @index (not parsed as named)', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    const customB64 = CUSTOM_PSK.toString('base64');

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`HamNet@9=${customB64}`],
    });

    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.has('HamNet')).toBe(false);
    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.has('HamNet')).toBe(false);
  });

  it('loads reporter LongFast@0 padded key into channelKeysByName as 32 bytes', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    const line = 'LongFast@0=ZUdhbGNWeThMN2FjcTNwb2wxcnFPRFc0UmJLSFRlY3E=';

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [line],
    });

    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.get('LongFast')?.length).toBe(32);
    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.get('LongFast')).toBe(0);
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

    const allDecryptKeys: Buffer[] = (manager as any).allDecryptKeys;
    expect(allDecryptKeys.filter((k) => k.equals(CUSTOM_PSK))).toHaveLength(1);
  });

  it('keeps only DEFAULT_PSK in allDecryptKeys when channelPsks is omitted', () => {
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

    const allDecryptKeys: Buffer[] = (manager as any).allDecryptKeys;
    expect(allDecryptKeys).toHaveLength(1);
    expect(allDecryptKeys[0]).toEqual(DEFAULT_PSK);
  });
});

describe('updateChannelKeys', () => {
  /** Test-only surface for private MQTTManager members used by channel-map regressions. */
  interface MqttManagerChannelTestAccess {
    _doConnect: () => void;
    channelNameToIndex: Map<string, number>;
    channelKeysByName: Map<string, Buffer>;
    onMessage: (topic: string, payload: Buffer) => void;
  }

  function mqttChannelTestAccess(manager: MQTTManager): MqttManagerChannelTestAccess {
    return manager as unknown as MqttManagerChannelTestAccess;
  }

  function stubMqttConnect(manager: MQTTManager): void {
    mqttChannelTestAccess(manager)._doConnect = () => {};
  }

  it('registers radio channel keys for decrypt and publish', () => {
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

    const aes256 = Buffer.alloc(32, 0xcd);
    manager.updateChannelKeys([{ name: 'HamPrivate', pskBase64: aes256.toString('base64') }]);

    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.get('HamPrivate')?.equals(aes256)).toBe(true);
    const allDecryptKeys: Buffer[] = (manager as any).allDecryptKeys;
    expect(allDecryptKeys.some((k) => k.equals(aes256))).toBe(true);
  });

  it('stores channel index mapping for topic attribution', () => {
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

    const aes256 = Buffer.alloc(32, 0xcd);
    manager.updateChannelKeys([
      { name: 'HamPrivate', pskBase64: aes256.toString('base64'), index: 2 },
    ]);

    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.get('HamPrivate')).toBe(2);
  });

  it('preserves custom LongFast from connect when radio sync pushes default public PSK', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`LongFast=${CUSTOM_PSK.toString('base64')}`],
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 0 }]);

    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.get('LongFast')?.equals(CUSTOM_PSK)).toBe(true);
  });

  it('records LongFast index when radio sync pushes default public PSK', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`LongFast=${CUSTOM_PSK.toString('base64')}`],
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const byName: Map<string, Buffer> = (manager as any).channelKeysByName;
    expect(byName.get('LongFast')?.equals(CUSTOM_PSK)).toBe(true);
    const nameToIndex: Map<string, number> = (manager as any).channelNameToIndex;
    expect(nameToIndex.get('LongFast')).toBe(1);
  });

  it('stores LongFast index mapping from default public radio sync', () => {
    const manager = new MQTTManager();
    stubMqttConnect(manager);
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    expect(mqttChannelTestAccess(manager).channelNameToIndex.get('LongFast')).toBe(1);
    expect(manager.getChannelNameToIndex()).toEqual({ LongFast: 1 });
  });

  it('cold-start then RF re-push: empty map then LongFast@1 (resolvedChannelConfigs path)', () => {
    const manager = new MQTTManager();
    stubMqttConnect(manager);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/CO/',
      autoLaunch: false,
    });

    // MQTT connected before RF channel configs arrived.
    expect(manager.getChannelNameToIndex().LongFast).toBeUndefined();

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);
    expect(manager.getChannelNameToIndex().LongFast).toBe(1);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[Meshtastic MQTT\] channelNameToIndex updated \(1\): LongFast=1/),
    );
    debugSpy.mockRestore();
  });

  it('Nathan/Colorado: radio LongFast@1 overrides manual LongFast@0 for topic attribution', () => {
    const manager = new MQTTManager();
    const access = mqttChannelTestAccess(manager);
    stubMqttConnect(manager);
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/CO/',
      autoLaunch: false,
      channelPsks: ['LongFast@0=AQ=='],
    });

    expect(access.channelNameToIndex.get('LongFast')).toBe(0);

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    expect(manager.getChannelNameToIndex().LongFast).toBe(1);
    // Manual default-public PSK preserved when radio also pushes AQ==
    expect(access.channelKeysByName.get('LongFast')?.equals(DEFAULT_PSK)).toBe(true);
  });

  it('Nathan/Colorado: inbound LongFast topic + packet channel 0 attributes to slot 1 after radio sync overrides @0', () => {
    const manager = new MQTTManager();
    const access = mqttChannelTestAccess(manager);
    stubMqttConnect(manager);
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/CO/',
      autoLaunch: false,
      channelPsks: ['LongFast@0=AQ=='],
    });
    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const nodeId = 0x095cf12b;
    const packetId = 0x00000099;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('Good morning everyone!'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: DEFAULT_PSK,
      channelName: 'LongFast',
      channel: 0,
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    access.onMessage('msh/US/CO/2/e/LongFast/!095cf12b', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
  });

  it('Nathan/Colorado: JSON LongFast with manual @0 then radio @1 attributes to slot 1', () => {
    const manager = new MQTTManager();
    const access = mqttChannelTestAccess(manager);
    stubMqttConnect(manager);
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/CO/',
      autoLaunch: false,
      channelPsks: ['LongFast@0=AQ=='],
    });
    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const nodeId = 0xaabbccdd;
    const json = {
      type: 'text',
      from: nodeId,
      channel: 0,
      text: 'json public chat',
    };

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    access.onMessage('msh/US/CO/2/json/LongFast/!aabbccdd', Buffer.from(JSON.stringify(json)));

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
  });

  it('keeps LongFast@1 when manual and radio both say slot 1', () => {
    const manager = new MQTTManager();
    stubMqttConnect(manager);
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: ['LongFast@1=AQ=='],
    });
    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);
    expect(manager.getChannelNameToIndex().LongFast).toBe(1);
  });

  it('preserves manual Garber PSK when radio sync pushes a different key', () => {
    const manager = new MQTTManager();
    const access = mqttChannelTestAccess(manager);
    stubMqttConnect(manager);
    const customGarber = Buffer.alloc(32, 0x11);
    const radioGarber = Buffer.alloc(32, 0x22);

    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`Garber@2=${customGarber.toString('base64')}`],
    });

    manager.updateChannelKeys([
      { name: 'Garber', pskBase64: radioGarber.toString('base64'), index: 2 },
    ]);

    expect(access.channelKeysByName.get('Garber')?.equals(customGarber)).toBe(true);
    expect(access.channelKeysByName.get('Garber')?.equals(radioGarber)).toBe(false);

    const nodeId = 0x11223344;
    const packetId = 0x00000041;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('manual garber key'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: customGarber,
      channelName: 'Garber',
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    access.onMessage('msh/US/2/e/Garber/!11223344', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { payload: string }).payload).toBe('manual garber key');
  });

  it('decrypts LongFast traffic with manual key after radio pushes default public PSK', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
      channelPsks: [`LongFast=${CUSTOM_PSK.toString('base64')}`],
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 0 }]);

    const nodeId = 0x11223355;
    const packetId = 0x00000042;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('longfast manual'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: CUSTOM_PSK,
      channelName: 'LongFast',
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223355', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { payload: string }).payload).toBe('longfast manual');
  });
});

describe('publish — decrypt round-trip (explicit PSK)', () => {
  it('decrypts broker echo of publish when pskBase64 is only passed on publish IPC', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/',
      autoLaunch: false,
    });

    const wrongRadioKey = Buffer.alloc(32, 0x22);
    manager.updateChannelKeys([
      { name: 'Garber', pskBase64: wrongRadioKey.toString('base64'), index: 2 },
    ]);

    const publish = wireConnected(manager);
    const custom32 = Buffer.alloc(32, 0xab);
    const from = 0x88d3b8b0;
    const gatewayId = `!${from.toString(16).padStart(8, '0')}`;

    manager.publish({
      text: 'echo test',
      from,
      channel: 2,
      channelName: 'Garber',
      pskBase64: custom32.toString('base64'),
      publishJsonMirror: false,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const protoPayload = publish.mock.calls[0][1] as Buffer;
    // Publish registers the packet id for dedup; clear so broker echo is processed.
    (manager as any).seenPacketIds.clear();

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage(`msh/US/2/e/Garber/${gatewayId}`, protoPayload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { payload: string }).payload).toBe('echo test');
    expect((messages[0] as { channel: number }).channel).toBe(2);
  });

  it('tries publish-time PSKs before radio channel keys in allDecryptKeys', () => {
    const manager = new MQTTManager();
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/',
      autoLaunch: false,
    });
    const radioKey = Buffer.alloc(32, 0x22);
    const publishKey = Buffer.alloc(32, 0xab);
    manager.updateChannelKeys([
      { name: 'Garber', pskBase64: radioKey.toString('base64'), index: 2 },
    ]);
    wireConnected(manager);
    manager.publish({
      text: 'order probe',
      from: 0x11223344,
      channel: 2,
      channelName: 'Garber',
      pskBase64: publishKey.toString('base64'),
      publishJsonMirror: false,
    });
    const keys: Buffer[] = (manager as any).allDecryptKeys;
    const publishIdx = keys.findIndex((k) => k.equals(publishKey));
    const radioIdx = keys.findIndex((k) => k.equals(radioKey));
    expect(publishIdx).toBeGreaterThan(-1);
    expect(radioIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeLessThan(radioIdx);
  });
});

describe('onMessage — encrypted TEXT_MESSAGE channel attribution', () => {
  it('attributes encrypted text to topic channel when topic map matches packet', () => {
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

    manager.updateChannelKeys([
      { name: 'HamPrivate', pskBase64: CUSTOM_PSK.toString('base64'), index: 2 },
    ]);

    const nodeId = 0x11223344;
    const packetId = 0x00000031;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('hello on channel 2'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: CUSTOM_PSK,
      channelName: 'HamPrivate',
      channel: 2,
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/HamPrivate/!11223344', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(2);
  });

  it('attributes LongFast topic to channel 0 when packet channel is 0 and no index map', () => {
    const manager = new MQTTManager();
    const nodeId = 0x11223355;
    const packetId = 0x00000032;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('hello primary'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223355', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('attributes LongFast on configured non-zero slot via topic channel map', () => {
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

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const nodeId = 0x11223355;
    const packetId = 0x00000034;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('hello longfast slot 1'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 1 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223355', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
  });

  it('uses topic LongFast fallback when no index map even when packet channel is 1', () => {
    const manager = new MQTTManager();
    const nodeId = 0x11223377;
    const packetId = 0x00000036;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('packet channel 1 no map'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 1 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223377', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('uses topic LongFast channel 0 when packet channel disagrees', () => {
    const manager = new MQTTManager();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 0 }]);

    const nodeId = 0x11223388;
    const packetId = 0x00000037;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('topic wins over packet channel'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 1 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223388', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
    expect(
      debugSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('TEXT topic channel (0) differs from packet channel (1)'),
      ),
    ).toBe(true);
    debugSpy.mockRestore();
  });

  it('attributes LongFast topic to slot 0 when packet channel exceeds 7', () => {
    const manager = new MQTTManager();
    const nodeId = 0x112233aa;
    const packetId = 0x00000039;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('channel clamp high'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: DEFAULT_PSK,
      channel: 8,
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!112233aa', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('attributes LongFast JSON text to topic channel 0 when json channel is negative', () => {
    const manager = new MQTTManager();
    const nodeId = 0x112233ab;
    const json = {
      type: 'text',
      from: nodeId,
      channel: -1,
      text: 'json channel clamp negative',
    };

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage(
      'msh/US/2/json/LongFast/!112233ab',
      Buffer.from(JSON.stringify(json)),
    );

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('uses JSON topic LongFast channel 1 when json.channel is 0 (Colorado regression)', () => {
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
    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const nodeId = 0x112233cd;
    const json = {
      type: 'text',
      from: nodeId,
      channel: 0,
      text: 'json topic slot 1',
    };

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage(
      'msh/US/2/json/LongFast/!112233cd',
      Buffer.from(JSON.stringify(json)),
    );

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
  });

  it('falls back to json.channel when topic has no parseable channel segment', () => {
    const manager = new MQTTManager();
    const nodeId = 0x112233ce;
    const json = {
      type: 'text',
      from: nodeId,
      channel: 2,
      text: 'non-standard topic channel fallback',
    };

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/CO/2/status/!112233ce', Buffer.from(JSON.stringify(json)));

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(2);
  });

  it('attributes omitted MeshPacket.channel to slot 0 on LongFast topic', () => {
    const manager = new MQTTManager();
    const nodeId = 0x112233ac;
    const packetId = 0x0000003b;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('gateway omitted channel field'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 0 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!112233ac', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('attributes decoded MQTT text to topic channel', () => {
    const manager = new MQTTManager();
    const nodeId = 0x11223399;
    const packetId = 0x00000038;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('decoded on channel 2'),
      }),
    );
    const payload = buildDecodedEnvelope({ nodeId, packetId, dataBytes, channel: 2 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!11223399', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
  });

  it('uses topic LongFast channel 0 when gateway packet channel is 1 (regression)', () => {
    const manager = new MQTTManager();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 0 }]);

    const nodeId = 0x112233bb;
    const packetId = 0x0000003c;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('gateway slot 1 user slot 0'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 1 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!112233bb', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
    expect(
      debugSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('TEXT topic channel (0) differs from packet channel (1)'),
      ),
    ).toBe(true);
    debugSpy.mockRestore();
  });

  it('uses topic LongFast channel 1 when gateway packet channel is 0 (Colorado regression)', () => {
    const manager = new MQTTManager();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (manager as any)._doConnect = () => {};
    manager.connect({
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/',
      autoLaunch: false,
    });

    manager.updateChannelKeys([{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }]);

    const nodeId = 0x112233cc;
    const packetId = 0x0000003d;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('gateway slot 0 user slot 1'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 0 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/LongFast/!112233cc', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
    expect(
      debugSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('TEXT topic channel (1) differs from packet channel (0)'),
      ),
    ).toBe(true);
    debugSpy.mockRestore();
  });

  it('attributes LongFast topic to slot 1 from renderer unnamed default-public entry shape', () => {
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

    // Shape emitted by meshtasticMqttChannelKeyEntries when slot 1 has empty name + AQ== PSK.
    manager.updateChannelKeys([
      { name: 'Private', pskBase64: Buffer.alloc(16, 9).toString('base64'), index: 0 },
      { name: 'LongFast', pskBase64: 'AQ==', index: 1 },
    ]);

    const nodeId = 0x11223366;
    const packetId = 0x00000035;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('unnamed longfast slot 1'),
      }),
    );
    const payload = buildEnvelope({ nodeId, packetId, dataBytes, psk: DEFAULT_PSK, channel: 1 });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/CO/2/e/LongFast/!11223366', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(1);
  });

  it('resubscribes to a more specific topic prefix without reconnecting', () => {
    const manager = new MQTTManager();
    const mockClient = {
      on: vi.fn(),
      end: vi.fn(),
      removeAllListeners: vi.fn(),
      connected: true,
      subscribe: vi.fn((_topic: string, cb: (err: Error | null) => void) => {
        cb(null);
      }),
      unsubscribe: vi.fn((_topic: string, cb: () => void) => {
        cb();
      }),
      publish: vi.fn(),
    };
    (manager as any).client = mockClient;
    (manager as any).currentSettings = {
      server: 'localhost',
      port: 1883,
      username: '',
      password: '',
      topicPrefix: 'msh/US/',
      autoLaunch: false,
    };
    (manager as any).subscribedWildcardTopic = 'msh/US/#';

    manager.updateTopicPrefix('msh/US/CO');

    expect(mockClient.unsubscribe).toHaveBeenCalledWith('msh/US/#', expect.any(Function));
    expect(mockClient.subscribe).toHaveBeenCalledWith('msh/US/CO/#', expect.any(Function));
    expect((manager as any).currentSettings.topicPrefix).toBe('msh/US/CO');
  });

  it('attributes unknown topic channel names to packet channel 0 when map has no index', () => {
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

    manager.updateChannelKeys([{ name: 'CustomChan', pskBase64: CUSTOM_PSK.toString('base64') }]);

    const nodeId = 0x11223366;
    const packetId = 0x00000033;
    const dataBytes = toBinary(
      DataSchema,
      create(DataSchema, {
        portnum: PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode('hello unknown map'),
      }),
    );
    const payload = buildEnvelope({
      nodeId,
      packetId,
      dataBytes,
      psk: CUSTOM_PSK,
      channelName: 'CustomChan',
    });

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/e/CustomChan/!11223366', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as { channel: number }).channel).toBe(0);
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

  it('normalizes large node ID (> 2^31) passed as unsigned number', () => {
    // 0xb2a7c770 = 2,997,340,016 — exceeds signed 32-bit max (2,147,483,647)
    const unsignedNodeId = 0xb2a7c770;
    const json = {
      type: 'USER',
      from: unsignedNodeId,
      user: { longName: 'Large Unsigned Node', shortName: 'LUN' },
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/json/LongFast/!b2a7c770', payload);

    expect(updates).toHaveLength(1);
    expect((updates[0] as Record<string, unknown>).node_id).toBe(0xb2a7c770);
  });

  it('normalizes large node ID passed as signed negative (firmware signed-int serialization)', () => {
    // Some firmware serializes uint32 node IDs > 2^31 as signed integers in JSON.
    // -1,297,627,280 is the signed 32-bit representation of 0xb2a7c770 (2,997,340,016).
    const signedNodeId = 0xb2a7c770 - 2 ** 32; // -1297627280
    const json = {
      type: 'USER',
      from: signedNodeId,
      user: { longName: 'Large Signed Node', shortName: 'LSN' },
    };
    const payload = Buffer.from(JSON.stringify(json));

    const updates: unknown[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));
    (manager as any).onMessage('msh/US/2/json/LongFast/!b2a7c770', payload);

    expect(updates).toHaveLength(1);
    expect((updates[0] as Record<string, unknown>).node_id).toBe(0xb2a7c770);
  });
});

describe('onMessage — JSON text large node ID', () => {
  let manager: MQTTManager;

  beforeEach(() => {
    manager = new MQTTManager();
  });

  it('normalizes sender_id for large node ID passed as signed negative in text message', () => {
    const signedNodeId = 0xb2a7c770 - 2 ** 32; // -1297627280
    const json = {
      type: 'text',
      from: signedNodeId,
      channel: 0,
      text: 'hello from large node',
    };
    const payload = Buffer.from(JSON.stringify(json));

    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage('msh/US/2/json/LongFast/!b2a7c770', payload);

    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).sender_id).toBe(0xb2a7c770);
    expect((messages[0] as Record<string, unknown>).sender_name).toBe('!b2a7c770');
  });

  it('uses padded hex sender_name for small node IDs', () => {
    const nodeId = 0x0bcd5737;
    const json = {
      type: 'text',
      from: nodeId,
      channel: 0,
      text: 'hi',
    };
    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));
    (manager as any).onMessage(
      'msh/US/2/json/LongFast/!0bcd5737',
      Buffer.from(JSON.stringify(json)),
    );
    expect((messages[0] as Record<string, unknown>).sender_name).toBe('!0bcd5737');
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

  it('silently ignores empty type + missing portnum messages (no debug)', () => {
    const payload = Buffer.from(
      JSON.stringify({
        from: 0x6982c484,
        to: 0xa2d67b68,
        type: '',
      }),
    );

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!6982c484', payload);

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('treats traceroute JSON as known and avoids any logging', () => {
    const payload = Buffer.from(
      JSON.stringify({
        from: 0x698524e8,
        to: 0x6982c484,
        type: 'traceroute',
        payload: { route: ['A', 'B'] },
      }),
    );

    (manager as any).onMessage('msh/US/CO/2/json/LongFast/!698524e8', payload);

    expect(debugSpy).not.toHaveBeenCalled();
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

  it('successfully decodes ServiceEnvelope with leading null bytes after trim', () => {
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
    const core = toBinary(ServiceEnvelopeSchema, envelope);
    const junkBytes = new Uint8Array(core.length + 3);
    junkBytes.set(core, 3);

    const updates: any[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    const debugSpy = vi.spyOn(console, 'debug');

    (manager as any).onMessage('msh/US/2/e/LongFast/!12345678', Buffer.from(junkBytes));

    expect(updates).toHaveLength(1);
    expect(updates[0].node_id).toBe(nodeId);

    const failedCalls = debugSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('Unknown message format'),
    );
    expect(failedCalls).toHaveLength(0);
    const decodeFailedCalls = debugSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('ServiceEnvelope decode failed'),
    );
    expect(decodeFailedCalls).toHaveLength(0);
  });

  it('successfully decodes ServiceEnvelope with leading and trailing null bytes', () => {
    const nodeId = 0xabcdef00;
    const packetId = 456;
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
    const core = toBinary(ServiceEnvelopeSchema, envelope);
    const padded = new Uint8Array(2 + core.length + 4);
    padded.set(core, 2);

    const updates: any[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!abcdef00', Buffer.from(padded));

    expect(updates).toHaveLength(1);
    expect(updates[0].node_id).toBe(nodeId);
  });

  it('all-null payload after trim is ignored without decode failure log', () => {
    const debugSpy = vi.spyOn(console, 'debug');
    debugSpy.mockClear();
    const updates: any[] = [];
    manager.on('nodeUpdate', (u) => updates.push(u));

    (manager as any).onMessage('msh/US/2/e/LongFast/!12345678', Buffer.alloc(16, 0));

    expect(updates).toHaveLength(0);
    const decodeFailedCalls = debugSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('ServiceEnvelope decode failed'),
    );
    expect(decodeFailedCalls).toHaveLength(0);
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

describe('onMessage — undecodable ServiceEnvelope signature cache', () => {
  let manager: MQTTManager;
  let decodeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    manager = new MQTTManager();
    decodeSpy = vi.spyOn(MQTTManager.prototype as any, 'decodeAndHandleServiceEnvelope');
  });

  afterEach(() => {
    decodeSpy.mockRestore();
  });

  it('skips a second decode attempt for the same topic + payload bytes', () => {
    // Field 1 (length-delimited) claims 100 bytes of MeshPacket but buffer is truncated — not recoverable.
    const bad = Buffer.from([0x0a, 0x64, ...Array(20).fill(0xab)]);
    const topic = 'msh/US/CO/2/e/LongFast/!835bb187';

    (manager as any).onMessage(topic, bad);
    (manager as any).onMessage(topic, bad);

    expect(decodeSpy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reconnect backoff + connect watchdog
// ─────────────────────────────────────────────────────────────────────────────

function getLastMockMqttClient(): {
  on: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
} {
  const r = vi.mocked(mqtt.connect).mock.results;
  if (r.length === 0) throw new Error('mqtt.connect not called');
  return r[r.length - 1].value as {
    on: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
}

function lastHandler(
  client: { on: ReturnType<typeof vi.fn> },
  event: string,
): (...args: unknown[]) => void {
  const hits = client.on.mock.calls.filter((c: unknown[]) => c[0] === event);
  const fn = hits[hits.length - 1]?.[1];
  if (typeof fn !== 'function') throw new Error(`no ${event} handler`);
  return fn as (...args: unknown[]) => void;
}

describe('MQTTManager reconnect backoff + connect watchdog', () => {
  const settings: MQTTSettings = {
    server: 'localhost',
    port: 1883,
    username: '',
    password: '',
    topicPrefix: 'msh/US/',
    autoLaunch: false,
    maxRetries: 3,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(mqtt.connect).mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs scheduled _doConnect after reconnect backoff while UI status is disconnected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const manager = new MQTTManager();
    manager.connect(settings);
    expect(manager.getStatus()).toBe('connecting');
    const client = getLastMockMqttClient();
    lastHandler(client, 'close')();
    expect(manager.getStatus()).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledTimes(2);
  });

  it('connect watchdog calls end and emits error when CONNACK never arrives', () => {
    const manager = new MQTTManager();
    const errorSpy = vi.fn();
    manager.on('error', errorSpy);
    manager.connect(settings);
    const client = getLastMockMqttClient();
    vi.advanceTimersByTime(12_000);
    expect(client.end).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timed out before MQTT session'));
  });

  it('does not set terminal error status for ENETDOWN (transient interface-down)', () => {
    const manager = new MQTTManager();
    manager.connect(settings);
    const client = getLastMockMqttClient();
    const enetdown = Object.assign(new Error('read ENETDOWN'), { code: 'ENETDOWN' });
    lastHandler(client, 'error')(enetdown);
    expect(manager.getStatus()).not.toBe('error');
  });

  it('handlePowerResume reconnects after ENETDOWN left status in error', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const manager = new MQTTManager();
    manager.connect(settings);
    const client = getLastMockMqttClient();
    const enetdown = Object.assign(new Error('read ENETDOWN'), { code: 'ENETDOWN' });
    lastHandler(client, 'error')(enetdown);
    lastHandler(client, 'close')();
    (manager as unknown as { status: string }).status = 'error';
    vi.mocked(mqtt.connect).mockClear();
    manager.handlePowerResume();
    expect(manager.getStatus()).not.toBe('error');
    expect(vi.mocked(mqtt.connect)).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// handleJsonText — packetId coercion and dedup
// ─────────────────────────────────────────────────────────────────────────────

describe('handleJsonText — packetId coercion and dedup', () => {
  const nodeHex = '12345678';
  const topic = `msh/US/2/json/LongFast/!${nodeHex}`;

  function jsonPayload(json: Record<string, unknown>): Buffer {
    return Buffer.from(JSON.stringify(json));
  }

  it('emits message with coerced uint32 packetId when json.id is a number', () => {
    const manager = new MQTTManager();
    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));

    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'hi', id: 0x80000001 }),
    );

    expect(messages).toHaveLength(1);
    expect((messages[0] as Record<string, unknown>).packetId).toBe(0x80000001 >>> 0);
  });

  it('emits packetId 0 and does not dedup when json.id is not a number', () => {
    const manager = new MQTTManager();
    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));

    // Send the same text twice with a string id — neither should be dropped
    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'hello', id: '99999' }),
    );
    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'hello', id: '99999' }),
    );

    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).packetId).toBe(0);
  });

  it('drops the second message with the same numeric packetId (dedup)', () => {
    const manager = new MQTTManager();
    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));

    const id = 0x00abcdef;
    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'dup', id }),
    );
    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'dup', id }),
    );

    expect(messages).toHaveLength(1);
  });

  it('does not dedup when packetId is 0 (even if sent twice)', () => {
    const manager = new MQTTManager();
    const messages: unknown[] = [];
    manager.on('message', (m) => messages.push(m));

    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'zero-id', id: 0 }),
    );
    (manager as any).onMessage(
      topic,
      jsonPayload({ type: 'text', from: `!${nodeHex}`, text: 'zero-id', id: 0 }),
    );

    expect(messages).toHaveLength(2);
  });
});

describe('portNumEnumToProtoName', () => {
  it('maps known PortNum values without scanning Object.entries each call', () => {
    expect(portNumEnumToProtoName(PortNum.TEXT_MESSAGE_APP)).toBe('TEXT_MESSAGE_APP');
    expect(portNumEnumToProtoName(PortNum.NODEINFO_APP)).toBe('NODEINFO_APP');
  });

  it('names the portnums added in protobufs 2.8.0', () => {
    expect(portNumEnumToProtoName(11)).toBe('ALERT_APP');
    expect(portNumEnumToProtoName(12)).toBe('KEY_VERIFICATION_APP');
    expect(portNumEnumToProtoName(13)).toBe('REMOTE_SHELL_APP');
    expect(portNumEnumToProtoName(36)).toBe('NODE_STATUS_APP');
    expect(portNumEnumToProtoName(37)).toBe('MESH_BEACON_APP');
    expect(portNumEnumToProtoName(78)).toBe('ATAK_PLUGIN_V2');
  });

  it('returns UNKNOWN_APP for unmapped port numbers', () => {
    expect(portNumEnumToProtoName(999_999)).toBe('UNKNOWN_APP');
  });
});

describe('bufferListIncludesKey', () => {
  it('matches buffers by contents, not base64 string identity', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([1, 2, 3]);
    const c = Buffer.from([9, 9, 9]);
    expect(bufferListIncludesKey([c], a)).toBe(false);
    expect(bufferListIncludesKey([c, b], a)).toBe(true);
  });
});

describe('enforceBadEnvelopeSignatureCap', () => {
  it('evicts expired signatures first', () => {
    const now = 1_000_000;
    const map = new Map<string, number>([
      ['a', now - 1],
      ['b', now + 60_000],
      ['c', now + 120_000],
    ]);
    enforceBadEnvelopeSignatureCap(map, now, 2);
    expect(map.has('a')).toBe(false);
    expect(map.size).toBeLessThanOrEqual(2);
  });

  it('evicts soonest-expiry entries when none are expired', () => {
    const now = 1_000_000;
    const map = new Map<string, number>();
    for (let i = 0; i < BAD_ENVELOPE_SIGNATURE_MAX + 5; i++) {
      map.set(`sig-${i}`, now + 60_000 + i);
    }
    enforceBadEnvelopeSignatureCap(map, now);
    expect(map.size).toBe(BAD_ENVELOPE_SIGNATURE_MAX);
    expect(map.has('sig-0')).toBe(false);
    expect(map.has(`sig-${BAD_ENVELOPE_SIGNATURE_MAX + 4}`)).toBe(true);
  });
});

describe('MQTTManager stale client isolation', () => {
  const settings: MQTTSettings = {
    server: 'localhost',
    port: 1883,
    username: '',
    password: '',
    topicPrefix: 'msh/US/',
    autoLaunch: false,
    maxRetries: 3,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(mqtt.connect).mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Distinct client object per connect() so handler identity can be distinguished. */
  function trackDistinctClients() {
    const made: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }[] = [];
    vi.mocked(mqtt.connect).mockImplementation((() => {
      const client = {
        on: vi.fn(),
        end: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: false,
        publish: vi.fn(),
        subscribe: vi.fn(),
      };
      made.push(client);
      return client;
    }) as unknown as typeof mqtt.connect);
    return made;
  }

  it('ignores close from a replaced client instead of reconnecting over the live one', () => {
    const made = trackDistinctClients();
    const manager = new MQTTManager();
    manager.on('error', () => {});

    manager.connect(settings);
    manager.connect(settings);
    expect(made).toHaveLength(2);

    // mqtt.js may emit close for the first client after end(true); it must not schedule a
    // reconnect that tears down the second, live client.
    lastHandler(made[0], 'close')();
    vi.advanceTimersByTime(300_000);

    expect(mqtt.connect).toHaveBeenCalledTimes(2);
  });

  it('still reconnects when the live client closes', () => {
    const made = trackDistinctClients();
    const manager = new MQTTManager();
    manager.on('error', () => {});

    manager.connect(settings);
    expect(made).toHaveLength(1);

    lastHandler(made[0], 'close')();
    vi.advanceTimersByTime(300_000);

    expect(vi.mocked(mqtt.connect).mock.calls.length).toBeGreaterThan(1);
  });
});
