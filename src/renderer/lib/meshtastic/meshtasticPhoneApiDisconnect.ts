import { create, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh } from '@meshtastic/protobufs';

import { errLikeToLogString } from '../errLikeToLogString';
import { writeToRadioWithoutQueue } from '../meshtasticBacklogUtils';
import { MS_PER_SECOND } from '../timeConstants';

/** Cap for teardown ToRadio.disconnect (includes toRadioDirectWriteChain wait). */
export const MESHTASTIC_PHONE_API_DISCONNECT_TIMEOUT_MS = 2 * MS_PER_SECOND;

/** Encode PhoneAPI ToRadio.disconnect so firmware resets STATE_SEND_* (#895). */
export function buildToRadioDisconnectBytes(): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: 'disconnect', value: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- External SDK value is validated by surrounding boundary logic.
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

/**
 * Best-effort ToRadio.disconnect before tearing down a MeshDevice.
 * Call only for serial (caller gates): without this, firmware PhoneAPI can keep
 * dumping an orphaned config handshake when the port reopens (#895).
 * Bounded so a hung writer / write-chain cannot block safeDisconnect port close.
 */
export async function sendMeshtasticPhoneApiDisconnect(device: MeshDevice): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = writeToRadioWithoutQueue(device, buildToRadioDisconnectBytes());
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('ToRadio.disconnect timed out'));
      }, MESHTASTIC_PHONE_API_DISCONNECT_TIMEOUT_MS);
    });
    await Promise.race([write, timeout]);
  } catch (e) {
    // catch-no-log-ok teardown: port may already be gone or write hung
    console.debug(
      '[meshtasticPhoneApiDisconnect] ToRadio.disconnect write failed ' + errLikeToLogString(e),
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
