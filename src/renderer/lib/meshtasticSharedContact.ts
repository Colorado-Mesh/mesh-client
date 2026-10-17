/**
 * Local-radio SharedContact helper (AdminMessage.add_contact).
 *
 * Used just-in-time before PKI single-dest sends (e.g. Store & Forward
 * CLIENT_HISTORY) so the firmware NodeDB has the destination pubkey without
 * permanently favoriting every peer on large meshes.
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { meshtasticNodePublicKeyBytesFromHex } from './meshtasticRemoteAdmin';

export interface BuildLocalAddContactToRadioParams {
  /** Connected radio node num (packet addressed to self). */
  myNodeNum: number;
  packetId: number;
  /** Contact to insert into the radio NodeDB. */
  nodeNum: number;
  longName: string;
  shortName: string;
  /** 32-byte destination public key. */
  publicKey: Uint8Array;
}

/** True when we have enough app-side fields to build a SharedContact. */
export function canBuildMeshtasticSharedContact(params: {
  publicKeyHex?: string;
  longName?: string;
  shortName?: string;
}): boolean {
  const key = meshtasticNodePublicKeyBytesFromHex(params.publicKeyHex);
  if (!key) return false;
  const longName = params.longName?.trim() ?? '';
  const shortName = params.shortName?.trim() ?? '';
  return longName.length > 0 && shortName.length > 0;
}

/**
 * Build ToRadio bytes for a local AdminMessage.add_contact (no remote-admin PKC).
 * Firmware may evict an LRU non-favorite if the NodeDB is full.
 */
export function buildLocalAddContactToRadioBytes(
  params: BuildLocalAddContactToRadioParams,
): Uint8Array {
  if (params.publicKey.length !== 32) {
    throw new Error('buildLocalAddContactToRadioBytes: publicKey must be 32 bytes');
  }
  const longName = params.longName.trim();
  const shortName = params.shortName.trim();
  if (!longName || !shortName) {
    throw new Error('buildLocalAddContactToRadioBytes: longName and shortName are required');
  }

  // Nested User/SharedContact inits use plain objects; create() typing rejects nested Message.
  const adminMsg = create(Admin.AdminMessageSchema, {
    payloadVariant: {
      case: 'addContact',
      value: {
        nodeNum: params.nodeNum >>> 0,
        user: {
          id: formatMeshtasticNodeId(params.nodeNum),
          longName,
          shortName,
          publicKey: params.publicKey,
        },
        shouldIgnore: false,
        manuallyVerified: false,
      },
    },
  });
  const adminPayload = toBinary(Admin.AdminMessageSchema, adminMsg);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
  const meshPacket = create(Mesh.MeshPacketSchema, {
    from: params.myNodeNum >>> 0,
    to: params.myNodeNum >>> 0,
    id: params.packetId >>> 0,
    wantAck: false,
    payloadVariant: {
      case: 'decoded',
      value: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
        portnum: Portnums.PortNum.ADMIN_APP,
        payload: adminPayload,
        wantResponse: false,
      },
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: 'packet', value: meshPacket },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
  return toBinary(Mesh.ToRadioSchema, toRadio);
}
