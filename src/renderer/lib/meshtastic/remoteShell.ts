/**
 * Meshtastic remote shell (`REMOTE_SHELL_APP`, portnum 13) frame codec and sender.
 *
 * Protocol exception: Meshtastic firmware feature only; MeshCore has no PTY transport and the
 * Reticulum equivalent (rnsh) has its own panel (`components/remote/RemoteShellSection.tsx`).
 *
 * Wire model (`meshtastic.RemoteShell`): OPEN/INPUT/RESIZE/CLOSE/PING/ACK go client → server;
 * OPEN_OK/OUTPUT/CLOSED/ERROR/PONG come back. `session_id` binds frames to one logical PTY, `seq`
 * numbers frames from each side, and `ack_seq` cumulatively acknowledges the peer's frames.
 *
 * Failure point: `decodeRemoteShellFrame` returns null on malformed bytes; the sender throws when
 * the radio handle is missing so the caller (session controller) can surface an error.
 */
import { create, fromBinary, type Message, toBinary } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv1';
import { Mesh, Portnums } from '@meshtastic/protobufs';

import { getIdentityIdForProtocol } from '../identityByProtocol';
import type { IdentityId } from '../types';

export type RemoteShellOp =
  | 'open'
  | 'input'
  | 'resize'
  | 'close'
  | 'ping'
  | 'ack'
  | 'openOk'
  | 'output'
  | 'closed'
  | 'error'
  | 'pong'
  | 'unset';

interface RemoteShellWire extends Message<'meshtastic.RemoteShell'> {
  op: number;
  sessionId: number;
  seq: number;
  ackSeq: number;
  payload: Uint8Array;
  cols: number;
  rows: number;
  flags: number;
}

// `Mesh` is the untyped generated barrel in this repo's tsconfig; declare the surface we use.
const MeshWire = Mesh as unknown as {
  RemoteShellSchema: GenMessage<RemoteShellWire>;
  RemoteShell_OpCode: Record<string, number>;
};
const RemoteShellSchema = MeshWire.RemoteShellSchema;
const WireOp = MeshWire.RemoteShell_OpCode;

const OP_TO_WIRE: Record<Exclude<RemoteShellOp, 'unset'>, number> = {
  open: WireOp.OPEN,
  input: WireOp.INPUT,
  resize: WireOp.RESIZE,
  close: WireOp.CLOSE,
  ping: WireOp.PING,
  ack: WireOp.ACK,
  openOk: WireOp.OPEN_OK,
  output: WireOp.OUTPUT,
  closed: WireOp.CLOSED,
  error: WireOp.ERROR,
  pong: WireOp.PONG,
};

const WIRE_TO_OP = new Map<number, RemoteShellOp>(
  Object.entries(OP_TO_WIRE).map(([op, wire]) => [wire, op as RemoteShellOp]),
);

export interface RemoteShellFrame {
  op: RemoteShellOp;
  sessionId: number;
  seq: number;
  ackSeq: number;
  payload: Uint8Array;
  cols: number;
  rows: number;
  flags: number;
}

/** LoRa MTU is ~237 bytes; leave room for the RemoteShell envelope fields. */
export const REMOTE_SHELL_MAX_PAYLOAD_BYTES = 180;

export function emptyRemoteShellFrame(op: RemoteShellOp, sessionId: number): RemoteShellFrame {
  return {
    op,
    sessionId,
    seq: 0,
    ackSeq: 0,
    payload: new Uint8Array(),
    cols: 0,
    rows: 0,
    flags: 0,
  };
}

export function encodeRemoteShellFrame(frame: RemoteShellFrame): Uint8Array {
  if (frame.op === 'unset') throw new TypeError('remote shell: cannot encode op "unset"');
  if (frame.payload.length > REMOTE_SHELL_MAX_PAYLOAD_BYTES) {
    throw new RangeError('remote shell: payload exceeds one LoRa frame');
  }
  return toBinary(
    RemoteShellSchema,
    create(RemoteShellSchema, {
      op: OP_TO_WIRE[frame.op],
      sessionId: frame.sessionId,
      seq: frame.seq,
      ackSeq: frame.ackSeq,
      payload: frame.payload,
      cols: frame.cols,
      rows: frame.rows,
      flags: frame.flags,
    }),
  );
}

/** Decode a `REMOTE_SHELL_APP` payload; null on malformed bytes. */
export function decodeRemoteShellFrame(bytes: Uint8Array): RemoteShellFrame | null {
  try {
    const msg = fromBinary(RemoteShellSchema, bytes);
    return {
      op: WIRE_TO_OP.get(msg.op) ?? 'unset',
      sessionId: msg.sessionId,
      seq: msg.seq,
      ackSeq: msg.ackSeq,
      payload: msg.payload,
      cols: msg.cols,
      rows: msg.rows,
      flags: msg.flags,
    };
  } catch (err) {
    console.debug('[remoteShell] malformed REMOTE_SHELL_APP payload', err);
    return null;
  }
}

/** Split text into UTF-8 chunks that each fit one frame without cutting a code point. */
export function chunkRemoteShellInput(text: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (currentBytes + size > REMOTE_SHELL_MAX_PAYLOAD_BYTES) {
      chunks.push(encoder.encode(current));
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) chunks.push(encoder.encode(current));
  return chunks;
}

export type RemoteShellSendFn = (
  identityId: IdentityId,
  destNodeNum: number,
  frame: RemoteShellFrame,
) => Promise<void>;

interface PacketSender {
  sendPacket: (
    bytes: Uint8Array,
    portNum: number,
    destination: number,
    channel?: number,
    wantAck?: boolean,
    wantResponse?: boolean,
  ) => Promise<unknown>;
}

/** Resolve the connected Meshtastic radio identity, or null. */
export function resolveRemoteShellIdentityId(): IdentityId | null {
  return getIdentityIdForProtocol('meshtastic');
}

/**
 * Default sender: wraps the frame in a `REMOTE_SHELL_APP` mesh packet to `destNodeNum` on the
 * primary channel (ACK requested, no response expected — the shell protocol has its own ACKs).
 * `getHandle` is injected to keep this module free of the ConnectionDriver import cycle.
 */
export function createRemoteShellSender(getHandle: (id: IdentityId) => unknown): RemoteShellSendFn {
  return async (identityId, destNodeNum, frame) => {
    const handle = getHandle(identityId) as PacketSender | null | undefined;
    if (!handle || typeof handle.sendPacket !== 'function') {
      throw new Error('Meshtastic radio not connected');
    }
    await handle.sendPacket(
      encodeRemoteShellFrame(frame),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- generated enum barrel is untyped
      Portnums.PortNum.REMOTE_SHELL_APP as number,
      destNodeNum,
      0,
      true,
      false,
    );
  };
}
