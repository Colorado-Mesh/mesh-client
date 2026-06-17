/** MeshCore {@link CONTACT_TYPE_LABELS} values (types 1–4) stored in shared `nodes.hw_model` by mistake. */
export const MESHCORE_CONTACT_HW_LABELS = ['Chat', 'Repeater', 'Room', 'Sensor'] as const;

export type MeshcoreContactHwLabel = (typeof MESHCORE_CONTACT_HW_LABELS)[number];

/** BBS room posts use channel index -2 in SQLite `meshcore_messages.channel_idx`. */
export const MESHCORE_ROOM_MESSAGE_CHANNEL = -2;

/** Room posts older than this are not still in-flight on the radio (matches hydration repair). */
export const MESHCORE_ROOM_STALE_SENDING_MS = 30_000;

/** True when `hw_model` is a MeshCore contact-type label (not a Meshtastic protobuf hardware name). */
export function meshcoreHwModelIsContactTypeLabel(hwModel: string | undefined): boolean {
  if (!hwModel) return false;
  return (MESHCORE_CONTACT_HW_LABELS as readonly string[]).includes(hwModel);
}
