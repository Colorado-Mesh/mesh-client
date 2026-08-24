import { create, toBinary } from '@bufbuild/protobuf';
import type { MeshDevice } from '@meshtastic/core';
import { Mesh } from '@meshtastic/protobufs';

import { errLikeToLogString } from '../errLikeToLogString';
import { writeToRadioWithoutQueue } from '../meshtasticBacklogUtils';

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
 */
export async function sendMeshtasticPhoneApiDisconnect(device: MeshDevice): Promise<void> {
  try {
    await writeToRadioWithoutQueue(device, buildToRadioDisconnectBytes());
  } catch (e) {
    // catch-no-log-ok teardown: port may already be gone
    console.debug(
      '[meshtasticPhoneApiDisconnect] ToRadio.disconnect write failed ' + errLikeToLogString(e),
    );
  }
}
