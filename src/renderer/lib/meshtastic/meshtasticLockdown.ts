/**
 * Firmware lockdown state (`FromRadio.lockdown_status`, field 18).
 *
 * A locked radio refuses configuration changes until it is unlocked with the
 * provisioned passphrase. `@meshtastic/core` 2.6.6 has no typed event for this
 * variant, so state arrives through the raw `onFromRadio` subscription.
 */
import { create, toBinary } from '@bufbuild/protobuf';
import { Admin, Mesh } from '@meshtastic/protobufs';

import type { ProtobufEnumDescriptor } from './protobufEnumOptions';

/** `AdminMessage.lockdown_auth` payload: provision, unlock, lock now, or disable. */
export interface MeshtasticLockdownAuthRequest {
  passphrase: string;
  /** Reboots the unlock survives (0 = firmware default). */
  bootsRemaining?: number;
  /** Unix epoch seconds after which the unlock expires. */
  validUntilEpoch?: number;
  /** Re-lock immediately instead of unlocking. */
  lockNow?: boolean;
  /** Maximum unlocked session length, seconds. */
  maxSessionSeconds?: number;
  /** Turn lockdown off entirely (requires the current passphrase). */
  disable?: boolean;
}

/**
 * Encodes an `AdminMessage.lockdown_auth` frame. Kept out of the runtime so the wire
 * shape (UTF-8 passphrase bytes, zeroed optionals) is directly testable.
 */
export function encodeMeshtasticLockdownAuth(auth: MeshtasticLockdownAuthRequest): Uint8Array {
  const msg = create(Admin.AdminMessageSchema, {
    payloadVariant: {
      case: 'lockdownAuth',
      value: {
        // `passphrase` is a bytes field; the firmware compares the UTF-8 encoding.
        passphrase: new TextEncoder().encode(auth.passphrase),
        bootsRemaining: auth.bootsRemaining ?? 0,
        validUntilEpoch: auth.validUntilEpoch ?? 0,
        lockNow: auth.lockNow ?? false,
        maxSessionSeconds: auth.maxSessionSeconds ?? 0,
        disable: auth.disable ?? false,
      },
    },
  });
  return toBinary(Admin.AdminMessageSchema, msg);
}

export type MeshtasticLockdownState =
  'STATE_UNSPECIFIED' | 'NEEDS_PROVISION' | 'LOCKED' | 'UNLOCKED' | 'UNLOCK_FAILED' | 'DISABLED';

export interface MeshtasticLockdownStatus {
  state: MeshtasticLockdownState;
  /** Firmware-supplied reason for the current lock, when it sends one. */
  lockReason?: string;
  /** Reboots left before the unlock session expires. */
  bootsRemaining?: number;
  /** Unix epoch seconds after which the unlock session expires. */
  validUntilEpoch?: number;
  /** Retry backoff after a failed unlock, seconds. */
  backoffSeconds?: number;
  /** When this client last received the status. */
  receivedAt: number;
}

const LOCKDOWN_STATE_NAMES = new Map<number, MeshtasticLockdownState>(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- generated enum barrel is untyped
  (Mesh.LockdownStatus_StateSchema as ProtobufEnumDescriptor).values.map((value) => [
    value.number,
    value.name as MeshtasticLockdownState,
  ]),
);

type Listener = (status: MeshtasticLockdownStatus | null) => void;

let current: MeshtasticLockdownStatus | null = null;
const listeners = new Set<Listener>();

const positiveInt = (value: unknown): number | undefined => {
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
};

/** Parses a raw `LockdownStatus` payload; returns null when the shape is unusable. */
export function parseMeshtasticLockdownStatus(raw: unknown): MeshtasticLockdownStatus | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const state = LOCKDOWN_STATE_NAMES.get(
    typeof value.state === 'number' ? value.state : Number.NaN,
  );
  if (state === undefined) return null;

  const lockReason = typeof value.lockReason === 'string' ? value.lockReason.trim() : '';
  return {
    state,
    lockReason: lockReason === '' ? undefined : lockReason,
    bootsRemaining: positiveInt(value.bootsRemaining),
    validUntilEpoch: positiveInt(value.validUntilEpoch),
    backoffSeconds: positiveInt(value.backoffSeconds),
    receivedAt: Date.now(),
  };
}

export function recordMeshtasticLockdownStatus(raw: unknown): MeshtasticLockdownStatus | null {
  const parsed = parseMeshtasticLockdownStatus(raw);
  if (!parsed) return null;
  current = parsed;
  for (const listener of listeners) listener(current);
  return parsed;
}

export function getMeshtasticLockdownStatus(): MeshtasticLockdownStatus | null {
  return current;
}

/** Cleared on disconnect so a stale lock state does not describe the next radio. */
export function clearMeshtasticLockdownStatus(): void {
  if (current === null) return;
  current = null;
  for (const listener of listeners) listener(current);
}

export function subscribeMeshtasticLockdownStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the radio will reject configuration writes until it is unlocked. */
export function isMeshtasticLockdownBlocking(
  status: MeshtasticLockdownStatus | null | undefined,
): boolean {
  return status?.state === 'LOCKED' || status?.state === 'UNLOCK_FAILED';
}
