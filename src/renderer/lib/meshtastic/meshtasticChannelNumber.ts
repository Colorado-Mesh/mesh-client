import { Types } from '@meshtastic/core';

export const MESHTASTIC_PRIMARY_CHANNEL = Types.ChannelNumber.Primary;

/** Channel slot index (0–7) as the `@meshtastic/core` enum that MeshDevice send APIs expect. */
export function toMeshtasticChannelNumber(index: number): Types.ChannelNumber {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- slot indexes come from channel config (0–7); firmware rejects anything else
  return index;
}
