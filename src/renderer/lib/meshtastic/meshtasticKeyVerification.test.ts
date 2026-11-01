import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildKeyVerificationAdminToRadioBytes,
  decodeKeyVerificationPacket,
  formatKeyVerificationSecurityNumber,
  meshtasticFirmwareSupportsKeyVerification,
  parseKeyVerificationSecurityNumber,
  registerMeshtasticKeyVerificationSender,
  sendMeshtasticKeyVerificationAdmin,
} from './meshtasticKeyVerification';

const KeyVerificationSchema = (
  Mesh as unknown as {
    KeyVerificationSchema: Parameters<typeof create>[0];
  }
).KeyVerificationSchema;

interface DecodedToRadio {
  payloadVariant: {
    case?: string;
    value: {
      from: number;
      to: number;
      id: number;
      payloadVariant: {
        case?: string;
        value: { portnum: number; payload: Uint8Array };
      };
    };
  };
}

function decodeAdmin(bytes: Uint8Array) {
  const toRadio = fromBinary(Mesh.ToRadioSchema, bytes) as unknown as DecodedToRadio;
  if (toRadio.payloadVariant.case !== 'packet') throw new Error('expected packet');
  const packet = toRadio.payloadVariant.value;
  if (packet.payloadVariant.case !== 'decoded') throw new Error('expected decoded');
  const decoded = packet.payloadVariant.value;
  const admin = fromBinary(Admin.AdminMessageSchema, decoded.payload);
  return { packet, decoded, admin };
}

describe('meshtasticFirmwareSupportsKeyVerification', () => {
  it.each([
    ['2.7.0', true],
    ['2.7.15.567b8ea', true],
    ['v2.8.1', true],
    ['3.0.0', true],
    ['2.6.11.60ec05e', false],
    ['1.3.0', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['unknown', false],
  ])('%s → %s', (version, expected) => {
    expect(meshtasticFirmwareSupportsKeyVerification(version)).toBe(expected);
  });
});

describe('security number helpers', () => {
  it('formats as zero-padded 3+3 digits', () => {
    expect(formatKeyVerificationSecurityNumber(123456)).toBe('123 456');
    expect(formatKeyVerificationSecurityNumber(42)).toBe('000 042');
  });

  it.each([
    ['123456', 123456],
    ['123 456', 123456],
    ['000042', 42],
    ['1', 1],
    ['999999', 999999],
  ])('parses %s', (input, expected) => {
    expect(parseKeyVerificationSecurityNumber(input)).toBe(expected);
  });

  it.each(['', '0', '000000', '1000000', '12a456', '-5', '1234567'])('rejects %j', (input) => {
    expect(parseKeyVerificationSecurityNumber(input)).toBeNull();
  });
});

describe('decodeKeyVerificationPacket', () => {
  it('decodes nonce and hash presence', () => {
    const bytes = toBinary(
      KeyVerificationSchema,
      create(KeyVerificationSchema, { nonce: 99n, hash2: new Uint8Array([1, 2, 3]) }),
    );
    expect(decodeKeyVerificationPacket(bytes)).toEqual({
      nonce: 99n,
      hasHash1: false,
      hasHash2: true,
    });
  });

  it('returns null for malformed bytes', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    expect(decodeKeyVerificationPacket(new Uint8Array([0xff, 0xff, 0xff]))).toBeNull();
  });
});

describe('buildKeyVerificationAdminToRadioBytes', () => {
  it('builds a local ADMIN_APP INITIATE_VERIFICATION', () => {
    const { packet, decoded, admin } = decodeAdmin(
      buildKeyVerificationAdminToRadioBytes({
        myNodeNum: 0x11,
        packetId: 7,
        request: { type: 'initiate', remoteNodeNum: 0x22 },
      }),
    );
    expect(packet.from).toBe(0x11);
    expect(packet.to).toBe(0x11);
    expect(packet.id).toBe(7);

    expect(decoded.portnum).toBe(Portnums.PortNum.ADMIN_APP);
    expect(admin.payloadVariant.case).toBe('keyVerification');
    if (admin.payloadVariant.case !== 'keyVerification') return;
    expect(admin.payloadVariant.value.messageType).toBe(
      Admin.KeyVerificationAdmin_MessageType.INITIATE_VERIFICATION,
    );
    expect(admin.payloadVariant.value.remoteNodenum).toBe(0x22);
    expect(admin.payloadVariant.value.securityNumber).toBeUndefined();
  });

  it('carries nonce and security number for PROVIDE_SECURITY_NUMBER', () => {
    const { admin } = decodeAdmin(
      buildKeyVerificationAdminToRadioBytes({
        myNodeNum: 1,
        packetId: 2,
        request: {
          type: 'provideSecurityNumber',
          remoteNodeNum: 3,
          nonce: 123456789012n,
          securityNumber: 654321,
        },
      }),
    );
    if (admin.payloadVariant.case !== 'keyVerification') throw new Error('wrong variant');
    expect(admin.payloadVariant.value.messageType).toBe(
      Admin.KeyVerificationAdmin_MessageType.PROVIDE_SECURITY_NUMBER,
    );
    expect(admin.payloadVariant.value.nonce).toBe(123456789012n);
    expect(admin.payloadVariant.value.securityNumber).toBe(654321);
  });

  it.each([
    ['doVerify', Admin.KeyVerificationAdmin_MessageType.DO_VERIFY],
    ['doNotVerify', Admin.KeyVerificationAdmin_MessageType.DO_NOT_VERIFY],
  ] as const)('maps %s', (type, wire) => {
    const { admin } = decodeAdmin(
      buildKeyVerificationAdminToRadioBytes({
        myNodeNum: 1,
        packetId: 2,
        request: { type, remoteNodeNum: 3, nonce: 5n },
      }),
    );
    if (admin.payloadVariant.case !== 'keyVerification') throw new Error('wrong variant');
    expect(admin.payloadVariant.value.messageType).toBe(wire);
  });

  it('rejects an out-of-range security number', () => {
    expect(() =>
      buildKeyVerificationAdminToRadioBytes({
        myNodeNum: 1,
        packetId: 2,
        request: { type: 'provideSecurityNumber', remoteNodeNum: 3, securityNumber: 0 },
      }),
    ).toThrow(/securityNumber/);
  });
});

describe('sender registry', () => {
  it('throws when no sender is registered', async () => {
    await expect(
      sendMeshtasticKeyVerificationAdmin({ type: 'initiate', remoteNodeNum: 1 }),
    ).rejects.toThrow(/No Meshtastic radio/);
  });

  it('delegates to the registered sender until unregistered', async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const unregister = registerMeshtasticKeyVerificationSender(sender);
    await sendMeshtasticKeyVerificationAdmin({ type: 'initiate', remoteNodeNum: 1 });
    expect(sender).toHaveBeenCalledWith({ type: 'initiate', remoteNodeNum: 1 });
    unregister();
    await expect(
      sendMeshtasticKeyVerificationAdmin({ type: 'initiate', remoteNodeNum: 1 }),
    ).rejects.toThrow();
  });
});
