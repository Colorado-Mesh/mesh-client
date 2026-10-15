/**
 * `MESH_BEACON_APP` payload codec (`meshtastic.MeshBeacon`).
 *
 * `@meshtastic/protobufs` 2.8.1 ships `mesh_beacon.proto` as Deno source only and does
 * not export it from `mod.ts`, so the schema is rebuilt here from the same embedded
 * descriptor. Drop this file once the package exports `MeshBeaconSchema`.
 */
import { create, fromBinary, type Message, toBinary } from '@bufbuild/protobuf';
import { fileDesc, type GenFile, type GenMessage, messageDesc } from '@bufbuild/protobuf/codegenv1';
import { Channel, Config } from '@meshtastic/protobufs';

const file_meshtastic_channel = (Channel as unknown as { file_meshtastic_channel: GenFile })
  .file_meshtastic_channel;

/** Upstream `meshtastic/mesh_beacon.proto` descriptor (protobufs 2.8.1). */
const file_meshtastic_mesh_beacon = fileDesc(
  // eslint-disable-next-line no-secrets/no-secrets -- public protobuf descriptor, not a credential
  'ChxtZXNodGFzdGljL21lc2hfYmVhY29uLnByb3RvEgptZXNodGFzdGljIqQCCgpNZXNoQmVhY29uEg8KB21lc3NhZ2UYASABKAkSMgoNb2ZmZXJfY2hhbm5lbBgCIAEoCzIbLm1lc2h0YXN0aWMuQ2hhbm5lbFNldHRpbmdzEj4KDG9mZmVyX3JlZ2lvbhgDIAEoDjIoLm1lc2h0YXN0aWMuQ29uZmlnLkxvUmFDb25maWcuUmVnaW9uQ29kZRJECgxvZmZlcl9wcmVzZXQYBCABKA4yKS5tZXNodGFzdGljLkNvbmZpZy5Mb1JhQ29uZmlnLk1vZGVtUHJlc2V0SACIAQESIQoUb2ZmZXJfZnJlcXVlbmN5X3Nsb3QYBSABKA1IAYgBAUIPCg1fb2ZmZXJfcHJlc2V0QhcKFV9vZmZlcl9mcmVxdWVuY3lfc2xvdEJmChRvcmcubWVzaHRhc3RpYy5wcm90b0IQTWVzaEJlYWNvblByb3Rvc1oiZ2l0aHViLmNvbS9tZXNodGFzdGljL2dvL2dlbmVyYXRlZKoCFE1lc2h0YXN0aWMuUHJvdG9idWZzugIAYgZwcm90bzM',
  [file_meshtastic_channel, Config.file_meshtastic_config],
);

export type MeshBeaconMessage = Message<'meshtastic.MeshBeacon'> & {
  message: string;
  offerChannel?: { name: string; psk: Uint8Array };
  offerRegion: number;
  offerPreset?: number;
  offerFrequencySlot?: number;
};

export const MeshBeaconSchema: GenMessage<MeshBeaconMessage> = messageDesc(
  file_meshtastic_mesh_beacon,
  0,
);

/** Decoded beacon in plain fields; `null` means the sender did not include that offer. */
export interface MeshBeaconPayload {
  message: string;
  offerChannel: { name: string; psk: Uint8Array } | null;
  /** `RegionCode`; 0 (`UNSET`) when not advertised. */
  offerRegion: number;
  offerPreset: number | null;
  offerFrequencySlot: number | null;
}

/** Decode a `MESH_BEACON_APP` payload. Returns `null` on malformed bytes. */
export function decodeMeshBeacon(bytes: Uint8Array): MeshBeaconPayload | null {
  let msg: MeshBeaconMessage;
  try {
    msg = fromBinary(MeshBeaconSchema, bytes);
  } catch (err) {
    console.debug('[meshBeaconCodec] malformed MESH_BEACON_APP payload', err);
    return null;
  }
  const ch = msg.offerChannel;
  const hasChannel = ch != null && (ch.name !== '' || ch.psk.length > 0);
  return {
    message: msg.message,
    offerChannel: hasChannel ? { name: ch.name, psk: ch.psk } : null,
    offerRegion: msg.offerRegion,
    offerPreset: msg.offerPreset ?? null,
    offerFrequencySlot:
      msg.offerFrequencySlot != null && msg.offerFrequencySlot > 0 ? msg.offerFrequencySlot : null,
  };
}

/** Encode a beacon payload (tests and simulators). */
export function encodeMeshBeacon(payload: Partial<MeshBeaconPayload>): Uint8Array {
  return toBinary(
    MeshBeaconSchema,
    create(MeshBeaconSchema, {
      message: payload.message ?? '',
      offerChannel: payload.offerChannel ?? undefined,
      offerRegion: payload.offerRegion ?? 0,
      offerPreset: payload.offerPreset ?? undefined,
      offerFrequencySlot: payload.offerFrequencySlot ?? undefined,
    }),
  );
}

/** True when the beacon advertises anything a listener could join. */
export function meshBeaconHasOffer(b: MeshBeaconPayload): boolean {
  return (
    b.offerChannel != null ||
    b.offerRegion !== 0 ||
    b.offerPreset != null ||
    b.offerFrequencySlot != null
  );
}
