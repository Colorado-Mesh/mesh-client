import { fromBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import { meshtasticNodePublicKeyBytesFromHex } from './meshtasticRemoteAdmin';
import {
  buildLocalAddContactToRadioBytes,
  canBuildMeshtasticSharedContact,
} from './meshtasticSharedContact';

const TEST_PUBKEY_HEX = '4852b69364572b52efa1b6bb3e6d0abed4f389a1cbfbb60a9bba2cce649caf0e';
const TEST_PUBKEY = meshtasticNodePublicKeyBytesFromHex(TEST_PUBKEY_HEX)!;

describe('canBuildMeshtasticSharedContact', () => {
  it('requires a 32-byte pubkey and non-empty names', () => {
    expect(
      canBuildMeshtasticSharedContact({
        publicKeyHex: TEST_PUBKEY_HEX,
        longName: 'SF Router',
        shortName: 'SFR',
      }),
    ).toBe(true);
    expect(
      canBuildMeshtasticSharedContact({
        publicKeyHex: TEST_PUBKEY_HEX,
        longName: '  ',
        shortName: 'SFR',
      }),
    ).toBe(false);
    expect(
      canBuildMeshtasticSharedContact({
        publicKeyHex: 'abcd',
        longName: 'SF Router',
        shortName: 'SFR',
      }),
    ).toBe(false);
  });
});

describe('buildLocalAddContactToRadioBytes', () => {
  it('builds a local AdminMessage.add_contact addressed to self', () => {
    const bytes = buildLocalAddContactToRadioBytes({
      myNodeNum: 0x11111111,
      packetId: 42,
      nodeNum: 0x22222222,
      longName: 'SF Router',
      shortName: 'SFR',
      publicKey: TEST_PUBKEY,
    });
    const toRadio = fromBinary(Mesh.ToRadioSchema, bytes) as unknown as {
      payloadVariant: {
        case?: string;
        value?: {
          from?: number;
          to?: number;
          id?: number;
          wantAck?: boolean;
          payloadVariant?: {
            case?: string;
            value?: { portnum?: number; wantResponse?: boolean; payload?: Uint8Array };
          };
        };
      };
    };
    expect(toRadio.payloadVariant.case).toBe('packet');
    const pkt = toRadio.payloadVariant.value;
    expect(pkt?.from).toBe(0x11111111);
    expect(pkt?.to).toBe(0x11111111);
    expect(pkt?.id).toBe(42);
    expect(pkt?.wantAck).toBe(false);
    expect(pkt?.payloadVariant?.case).toBe('decoded');
    expect(pkt?.payloadVariant?.value?.portnum).toBe(Portnums.PortNum.ADMIN_APP);
    expect(pkt?.payloadVariant?.value?.wantResponse).toBe(false);

    const admin = fromBinary(
      Admin.AdminMessageSchema,
      pkt!.payloadVariant!.value!.payload!,
    ) as unknown as {
      payloadVariant: {
        case?: string;
        value?: {
          nodeNum?: number;
          user?: { id?: string; longName?: string; shortName?: string; publicKey?: Uint8Array };
        };
      };
    };
    expect(admin.payloadVariant.case).toBe('addContact');
    expect(admin.payloadVariant.value?.nodeNum).toBe(0x22222222);
    expect(admin.payloadVariant.value?.user?.id).toBe('!22222222');
    expect(admin.payloadVariant.value?.user?.longName).toBe('SF Router');
    expect(admin.payloadVariant.value?.user?.shortName).toBe('SFR');
    expect(admin.payloadVariant.value?.user?.publicKey).toEqual(TEST_PUBKEY);
  });

  it('rejects invalid public key length', () => {
    expect(() =>
      buildLocalAddContactToRadioBytes({
        myNodeNum: 1,
        packetId: 1,
        nodeNum: 2,
        longName: 'A',
        shortName: 'B',
        publicKey: new Uint8Array(16),
      }),
    ).toThrow(/32 bytes/);
  });
});
