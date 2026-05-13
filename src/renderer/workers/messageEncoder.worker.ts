/// <reference lib="webworker" />

import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';

/** Meshtastic app port for plaintext channel messages (`PortNum.TEXT_MESSAGE_APP`). */
const TEXT_MESSAGE_APP = Portnums.PortNum.TEXT_MESSAGE_APP;

import { errLikeToLogString } from '../lib/errLikeToLogString';
import type { WorkerCommand, WorkerEvent } from '../lib/transport/types';

// Only accept messages from our renderer (Electron: file/null in prod, localhost in dev).
const ALLOWED_ORIGINS = [
  'null',
  'file://',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
];

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  if (!ALLOWED_ORIGINS.includes(event.origin)) {
    return;
  }
  const data: unknown = event.data;
  // @typescript-eslint/no-floating-promises: worker onmessage is fire-and-forget
  if (typeof data !== 'object' || data === null || !('type' in data)) {
    return;
  }
  if (data.type !== 'ENCODE_MESSAGE') {
    return;
  }

  const cmd = data as WorkerCommand;

  try {
    const decodedPayload: {
      portnum: typeof TEXT_MESSAGE_APP;
      payload: Uint8Array;
      replyId?: number;
    } = {
      portnum: TEXT_MESSAGE_APP,
      payload: new TextEncoder().encode(cmd.text),
    };

    if (cmd.replyId != null) {
      decodedPayload.replyId = cmd.replyId;
    }

    const toRadio = create(Mesh.ToRadioSchema, {
      payloadVariant: {
        case: 'packet',
        value: {
          to: cmd.dest,
          from: cmd.from,
          channel: cmd.channel,
          payloadVariant: {
            case: 'decoded',
            value: decodedPayload,
          },
        },
      },
    });

    const buffer = toBinary(Mesh.ToRadioSchema, toRadio).buffer;

    const reply: WorkerEvent = { type: 'ENCODED', id: cmd.id, buffer };
    (self as unknown as Worker).postMessage(reply, [buffer]);
  } catch (err) {
    console.warn('[messageEncoder.worker] encode failed ' + errLikeToLogString(err));
    const reply: WorkerEvent = { type: 'ERROR', id: cmd.id, error: String(err) };
    (self as unknown as Worker).postMessage(reply);
  }
};
