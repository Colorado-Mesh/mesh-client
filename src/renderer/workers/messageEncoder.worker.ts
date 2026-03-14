/// <reference lib="webworker" />

import { toBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';

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
  if (!event || !ALLOWED_ORIGINS.includes(event.origin)) {
    return;
  }
  if (
    typeof event.data !== 'object' ||
    event.data === null ||
    !('type' in event.data) ||
    (event.data as { type?: string }).type !== 'ENCODE_MESSAGE'
  ) {
    return;
  }

  const cmd = event.data;

  if (cmd.type !== 'ENCODE_MESSAGE') return;

  try {
    const decodedPayload: {
      portnum: 1;
      payload: Uint8Array;
      replyId?: number;
    } = {
      portnum: 1, // TEXT_MESSAGE_APP
      payload: new TextEncoder().encode(cmd.text),
    };

    if (cmd.replyId != null) {
      decodedPayload.replyId = cmd.replyId;
    }

    const toRadio = {
      payloadVariant: {
        case: 'packet' as const,
        value: {
          to: cmd.dest,
          from: cmd.from,
          channel: cmd.channel,
          payloadVariant: {
            case: 'decoded' as const,
            value: decodedPayload,
          },
        },
      },
    };

    const buffer = toBinary(Mesh.ToRadioSchema, toRadio as any).buffer as ArrayBuffer;

    const reply: WorkerEvent = { type: 'ENCODED', id: cmd.id, buffer };
    (self as unknown as Worker).postMessage(reply, [buffer]);
  } catch (err) {
    const reply: WorkerEvent = { type: 'ERROR', id: cmd.id, error: String(err) };
    (self as unknown as Worker).postMessage(reply);
  }
};
