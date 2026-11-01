/**
 * Meshtastic manual key verification (`KEY_VERIFICATION_APP`, portnum 12).
 *
 * Protocol-specific by design: PKC key verification is a Meshtastic firmware feature
 * (>= 2.7); MeshCore and Reticulum have no equivalent, so this is gated by
 * `ProtocolCapabilities.hasKeyVerification` rather than shared across protocols.
 *
 * Wire model (confirmed against `@meshtastic/protobufs` 2.8.x `KeyVerification*`):
 * - The client drives its *local* radio with `AdminMessage.key_verification`
 *   (`KeyVerificationAdmin`: INITIATE_VERIFICATION → PROVIDE_SECURITY_NUMBER →
 *   DO_VERIFY / DO_NOT_VERIFY).
 * - The radios exchange `KeyVerification` (nonce / hash1 / hash2) over the mesh on
 *   `KEY_VERIFICATION_APP`.
 * - The radio reports progress to the client with `FromRadio.clientNotification`
 *   payloads: `KeyVerificationNumberInform` (responder: show the security number),
 *   `KeyVerificationNumberRequest` (initiator: ask for that number) and
 *   `KeyVerificationFinal` (both: compare the verification characters).
 *
 * Failure point: pure helpers only. Decode failures return null; the sender (registered
 * by the Meshtastic runtime) throws when no radio is connected and callers surface it.
 */
import { create, fromBinary, type Message, toBinary } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv1';
import { Admin, Mesh, Portnums } from '@meshtastic/protobufs';

const KeyVerificationSchema = (
  Mesh as unknown as {
    KeyVerificationSchema: GenMessage<
      Message<'meshtastic.KeyVerification'> & {
        nonce: bigint;
        hash1: Uint8Array;
        hash2: Uint8Array;
      }
    >;
  }
).KeyVerificationSchema;

/** First firmware release that ships `KeyVerificationModule` (admin tag 67). */
export const MESHTASTIC_KEY_VERIFICATION_MIN_FIRMWARE = { major: 2, minor: 7 } as const;

/** Firmware security numbers are 1..999999 (six digits, zero-padded for display). */
export const KEY_VERIFICATION_SECURITY_NUMBER_MAX = 999_999;

/**
 * True when the firmware string (e.g. `2.7.15.abc1234`) is at least 2.7.
 * Unknown / unparsable versions are unsupported so the UI shows the notice instead of
 * sending an admin message the radio would silently ignore.
 */
export function meshtasticFirmwareSupportsKeyVerification(
  firmwareVersion: string | null | undefined,
): boolean {
  if (!firmwareVersion) return false;
  const match = /^v?(\d+)\.(\d+)/.exec(firmwareVersion.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const min = MESHTASTIC_KEY_VERIFICATION_MIN_FIRMWARE;
  return major > min.major || (major === min.major && minor >= min.minor);
}

/** Display form of the firmware security number: zero-padded to six digits, `123 456`. */
export function formatKeyVerificationSecurityNumber(value: number): string {
  const digits = String(Math.trunc(value)).padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** Parse operator input (digits, optional spaces) into a valid security number, else null. */
export function parseKeyVerificationSecurityNumber(input: string): number | null {
  const digits = input.replace(/\s+/g, '');
  if (!/^\d{1,6}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 1 && value <= KEY_VERIFICATION_SECURITY_NUMBER_MAX ? value : null;
}

export interface KeyVerificationPacket {
  nonce: bigint;
  /** hash1 present (final authoritative hash, A → B). */
  hasHash1: boolean;
  /** hash2 present (intermediary hash, B → A). */
  hasHash2: boolean;
}

/** Decode a `KEY_VERIFICATION_APP` payload (`meshtastic.KeyVerification`); null if malformed. */
export function decodeKeyVerificationPacket(bytes: Uint8Array): KeyVerificationPacket | null {
  try {
    const msg = fromBinary(KeyVerificationSchema, bytes);
    return {
      nonce: msg.nonce,
      hasHash1: msg.hash1.length > 0,
      hasHash2: msg.hash2.length > 0,
    };
  } catch (err) {
    console.debug('[meshtasticKeyVerification] malformed KEY_VERIFICATION_APP payload', err);
    return null;
  }
}

export type KeyVerificationAdminType =
  'initiate' | 'provideSecurityNumber' | 'doVerify' | 'doNotVerify';

export interface KeyVerificationAdminRequest {
  type: KeyVerificationAdminType;
  /** Node being verified (`remote_nodenum`). */
  remoteNodeNum: number;
  /** Nonce from `KeyVerificationNumberRequest` / `Final`; 0 for `initiate`. */
  nonce?: bigint;
  /** Required for `provideSecurityNumber`. */
  securityNumber?: number;
}

function adminMessageType(type: KeyVerificationAdminType): Admin.KeyVerificationAdmin_MessageType {
  switch (type) {
    case 'initiate':
      return Admin.KeyVerificationAdmin_MessageType.INITIATE_VERIFICATION;
    case 'provideSecurityNumber':
      return Admin.KeyVerificationAdmin_MessageType.PROVIDE_SECURITY_NUMBER;
    case 'doVerify':
      return Admin.KeyVerificationAdmin_MessageType.DO_VERIFY;
    case 'doNotVerify':
      return Admin.KeyVerificationAdmin_MessageType.DO_NOT_VERIFY;
  }
}

/** ToRadio bytes for a local `AdminMessage.key_verification` (addressed to our own node). */
export function buildKeyVerificationAdminToRadioBytes(params: {
  myNodeNum: number;
  packetId: number;
  request: KeyVerificationAdminRequest;
}): Uint8Array {
  const { request } = params;
  if (request.type === 'provideSecurityNumber') {
    const n = request.securityNumber;
    if (n == null || !Number.isInteger(n) || n < 1 || n > KEY_VERIFICATION_SECURITY_NUMBER_MAX) {
      throw new Error('buildKeyVerificationAdminToRadioBytes: invalid securityNumber');
    }
  }
  const adminMsg = create(Admin.AdminMessageSchema, {
    payloadVariant: {
      case: 'keyVerification',
      value: {
        messageType: adminMessageType(request.type),
        remoteNodenum: request.remoteNodeNum >>> 0,
        nonce: request.nonce ?? 0n,
        ...(request.type === 'provideSecurityNumber'
          ? { securityNumber: request.securityNumber }
          : {}),
      },
    },
  });
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
        payload: toBinary(Admin.AdminMessageSchema, adminMsg),
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

/** Sends one key-verification admin request to the connected radio; throws when offline. */
export type KeyVerificationSender = (request: KeyVerificationAdminRequest) => Promise<void>;

let registeredSender: KeyVerificationSender | null = null;

/** Registered by the Meshtastic runtime wire effects; returns an unregister function. */
export function registerMeshtasticKeyVerificationSender(sender: KeyVerificationSender): () => void {
  registeredSender = sender;
  return () => {
    if (registeredSender === sender) registeredSender = null;
  };
}

export async function sendMeshtasticKeyVerificationAdmin(
  request: KeyVerificationAdminRequest,
): Promise<void> {
  if (!registeredSender) throw new Error('No Meshtastic radio connected for key verification');
  await registeredSender(request);
}
