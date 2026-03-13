/// <reference lib="webworker" />

import { toBinary } from '@bufbuild/protobuf';
import { Mesh } from '@meshtastic/protobufs';

import type { WorkerCommand, WorkerEvent } from '../lib/transport/types';

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;

  if (cmd.type !== 'ENCODE_MESSAGE') return;

  try {
    const toRadio = {
      payloadVariant: {
        case: 'packet' as const,
        value: {
          to: cmd.dest,
          from: cmd.from,
          channel: cmd.channel,
          payloadVariant: {
            case: 'decoded' as const,
            value: {
              portnum: 1, // TEXT_MESSAGE_APP
              payload: new TextEncoder().encode(cmd.text),
              replyId: cmd.replyId ?? 0,
            },
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
