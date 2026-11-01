/**
 * Session state for the Meshtastic manual key-verification flow (one active session).
 *
 * Meshtastic-only by design: firmware key verification has no MeshCore / Reticulum analogue.
 * Memory-only (never persisted): a session is bound to a live radio handshake nonce, and
 * `NodeInfo.is_key_manually_verified` is re-read from the radio on every connect.
 *
 * Failure point: a send failure leaves the session in phase `error` (dialog shows a retry-free
 * notice and can be dismissed); the radio times out its own half-finished handshake.
 */
import { create } from 'zustand';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { getIdentityNode } from '../lib/identityStoreReads';
import {
  type KeyVerificationAdminRequest,
  parseKeyVerificationSecurityNumber,
  sendMeshtasticKeyVerificationAdmin,
} from '../lib/meshtastic/meshtasticKeyVerification';
import type { IdentityId } from '../lib/types';
import { patchNodeKeyManuallyVerified, useNodeStore } from './nodeStore';

export type KeyVerificationPhase =
  /** INITIATE sent; waiting for the remote node's reply (radio will ask for the number). */
  | 'initiating'
  /** Responder: show this security number to the initiator out-of-band. */
  | 'showNumber'
  /** Initiator: type the security number the remote operator read out. */
  | 'enterNumber'
  /** Number sent; waiting for the final hash comparison from the radio. */
  | 'awaitingFinal'
  /** Both: compare verification characters, then confirm or reject. */
  | 'compare'
  | 'done'
  | 'rejected'
  | 'error';

export type KeyVerificationErrorCode = 'send_failed' | 'invalid_number';

export interface KeyVerificationSession {
  identityId: IdentityId;
  phase: KeyVerificationPhase;
  /** Handshake nonce; 0n until the radio reports one. */
  nonce: bigint;
  /** Resolved remote node; null until known (responder side learns it from the mesh packet). */
  remoteNodeNum: number | null;
  remoteLongname: string;
  /** Responder-side six-digit security number. */
  securityNumber?: number;
  /** Final comparison string shown on both radios. */
  verificationCharacters?: string;
  /** True when this radio initiated the handshake. */
  isSender?: boolean;
  errorCode?: KeyVerificationErrorCode;
}

/** `KEY_VERIFICATION_APP` packets seen by nonce → originating node (bounded). */
const MAX_NONCE_ENTRIES = 16;

interface KeyVerificationState {
  session: KeyVerificationSession | null;
  nonceToNode: Map<bigint, number>;
}

export const useKeyVerificationStore = create<KeyVerificationState>()(() => ({
  session: null,
  nonceToNode: new Map(),
}));

function patchSession(patch: Partial<KeyVerificationSession>): void {
  useKeyVerificationStore.setState((s) =>
    s.session ? { session: { ...s.session, ...patch } } : s,
  );
}

/** Match a remote long name against the identity's nodes; null when absent or ambiguous. */
function resolveNodeByLongname(identityId: IdentityId, longname: string): number | null {
  const wanted = longname.trim();
  if (!wanted) return null;
  const byId = useNodeStore.getState().nodes[identityId] as
    Record<number, { nodeId: number; longName?: string }> | undefined;
  if (!byId) return null;
  let found: number | null = null;
  for (const record of Object.values(byId)) {
    if (record.longName?.trim() !== wanted) continue;
    if (found != null) return null;
    found = record.nodeId;
  }
  return found;
}

function rememberNonce(nonceToNode: Map<bigint, number>, nonce: bigint, from: number): void {
  nonceToNode.delete(nonce);
  nonceToNode.set(nonce, from);
  while (nonceToNode.size > MAX_NONCE_ENTRIES) {
    const oldest = nonceToNode.keys().next().value;
    if (oldest === undefined) break;
    nonceToNode.delete(oldest);
  }
}

/** Record a decoded `KEY_VERIFICATION_APP` packet so notifications can be tied to a node. */
export function recordKeyVerificationPacket(
  identityId: IdentityId,
  packet: { from: number; nonce: bigint },
): void {
  if (packet.nonce === 0n || packet.from <= 0) return;
  useKeyVerificationStore.setState((s) => {
    const nonceToNode = new Map(s.nonceToNode);
    rememberNonce(nonceToNode, packet.nonce, packet.from);
    const session = s.session;
    if (
      session?.identityId === identityId &&
      session.remoteNodeNum == null &&
      session.nonce === packet.nonce
    ) {
      return { nonceToNode, session: { ...session, remoteNodeNum: packet.from } };
    }
    return { nonceToNode };
  });
}

/** Minimal shape of the `FromRadio.clientNotification` payload we consume. */
export interface KeyVerificationClientNotification {
  payloadVariant?: {
    case?: string;
    value?: {
      nonce?: bigint;
      remoteLongname?: string;
      securityNumber?: number;
      isSender?: boolean;
      verificationCharacters?: string;
    };
  };
}

/**
 * Advance the session from a `ClientNotification`. Returns true when the notification was a
 * key-verification variant (so callers can skip generic notification handling).
 */
export function applyKeyVerificationClientNotification(
  identityId: IdentityId,
  notification: KeyVerificationClientNotification | null | undefined,
): boolean {
  const variant = notification?.payloadVariant;
  const value = variant?.value;
  if (!variant || !value) return false;
  const nonce = typeof value.nonce === 'bigint' ? value.nonce : 0n;
  const remoteLongname = typeof value.remoteLongname === 'string' ? value.remoteLongname : '';

  switch (variant.case) {
    case 'keyVerificationNumberInform':
    case 'keyVerificationNumberRequest':
    case 'keyVerificationFinal': {
      const state = useKeyVerificationStore.getState();
      const current = state.session;
      const reusable = current?.identityId === identityId;
      const remoteNodeNum =
        (reusable ? current.remoteNodeNum : null) ??
        state.nonceToNode.get(nonce) ??
        resolveNodeByLongname(identityId, remoteLongname);
      const base: KeyVerificationSession = {
        identityId,
        phase: 'initiating',
        nonce,
        remoteNodeNum,
        remoteLongname: remoteLongname || (reusable ? current.remoteLongname : ''),
        ...(reusable ? { isSender: current.isSender } : {}),
      };
      let next: KeyVerificationSession;
      if (variant.case === 'keyVerificationNumberInform') {
        next = {
          ...base,
          phase: 'showNumber',
          isSender: false,
          securityNumber: typeof value.securityNumber === 'number' ? value.securityNumber : 0,
        };
      } else if (variant.case === 'keyVerificationNumberRequest') {
        next = { ...base, phase: 'enterNumber', isSender: true };
      } else {
        next = {
          ...base,
          phase: 'compare',
          isSender: value.isSender === true,
          verificationCharacters:
            typeof value.verificationCharacters === 'string' ? value.verificationCharacters : '',
        };
      }
      useKeyVerificationStore.setState({ session: next });
      return true;
    }
    default:
      return false;
  }
}

async function sendOrFail(request: KeyVerificationAdminRequest): Promise<boolean> {
  try {
    await sendMeshtasticKeyVerificationAdmin(request);
    return true;
  } catch (err) {
    console.warn('[keyVerificationStore] admin send failed ' + errLikeToLogString(err));
    patchSession({ phase: 'error', errorCode: 'send_failed' });
    return false;
  }
}

/** Start verifying `remoteNodeNum` (we are the initiator). */
export async function initiateKeyVerification(
  identityId: IdentityId,
  remoteNodeNum: number,
  remoteLongname: string,
): Promise<void> {
  useKeyVerificationStore.setState({
    session: {
      identityId,
      phase: 'initiating',
      nonce: 0n,
      remoteNodeNum,
      remoteLongname,
      isSender: true,
    },
  });
  await sendOrFail({ type: 'initiate', remoteNodeNum });
}

/** Initiator: forward the security number read out by the remote operator. */
export async function submitKeyVerificationSecurityNumber(input: string): Promise<void> {
  const session = useKeyVerificationStore.getState().session;
  if (session?.phase !== 'enterNumber') return;
  const securityNumber = parseKeyVerificationSecurityNumber(input);
  if (securityNumber == null) {
    patchSession({ errorCode: 'invalid_number' });
    return;
  }
  patchSession({ phase: 'awaitingFinal', errorCode: undefined });
  await sendOrFail({
    type: 'provideSecurityNumber',
    remoteNodeNum: session.remoteNodeNum ?? 0,
    nonce: session.nonce,
    securityNumber,
  });
}

/**
 * Operator compared the verification characters. `matches=true` tells the radio to mark the
 * node manually verified and mirrors `is_key_manually_verified` into the node store so the
 * badge appears without waiting for a NodeInfo refresh (the firmware does not push one).
 */
export async function confirmKeyVerification(matches: boolean): Promise<void> {
  const session = useKeyVerificationStore.getState().session;
  if (session?.phase !== 'compare') return;
  const ok = await sendOrFail({
    type: matches ? 'doVerify' : 'doNotVerify',
    remoteNodeNum: session.remoteNodeNum ?? 0,
    nonce: session.nonce,
  });
  if (!ok) return;
  if (!matches) {
    patchSession({ phase: 'rejected' });
    return;
  }
  const remote = session.remoteNodeNum;
  if (remote != null && getIdentityNode(session.identityId, remote)) {
    patchNodeKeyManuallyVerified(session.identityId, remote, true);
  } else {
    console.debug('[keyVerificationStore] verified node not resolved; badge updates on next sync');
  }
  patchSession({ phase: 'done' });
}

/** Cancel an in-flight handshake (radio side `DO_NOT_VERIFY`) and close the dialog. */
export function cancelKeyVerification(): void {
  const session = useKeyVerificationStore.getState().session;
  useKeyVerificationStore.setState({ session: null });
  if (!session || session.phase === 'done' || session.phase === 'rejected') return;
  if (session.phase === 'error') return;
  void sendMeshtasticKeyVerificationAdmin({
    type: 'doNotVerify',
    remoteNodeNum: session.remoteNodeNum ?? 0,
    nonce: session.nonce,
  }).catch((err: unknown) => {
    console.debug('[keyVerificationStore] cancel send failed ' + errLikeToLogString(err));
  });
}

/** Close the dialog without notifying the radio (terminal phases). */
export function dismissKeyVerification(): void {
  useKeyVerificationStore.setState({ session: null });
}

export function resetKeyVerificationStore(): void {
  useKeyVerificationStore.setState({ session: null, nonceToNode: new Map() });
}
