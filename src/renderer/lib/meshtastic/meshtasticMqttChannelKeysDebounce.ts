/**
 * Debounce Meshtastic MQTT channel-key pushes while RF channel configs stream in.
 * `push` runs with whatever state it closes over / reads from refs at fire time.
 */
export interface DebouncedMqttChannelKeysPush {
  schedule: () => void;
  cancel: () => void;
}

export function createDebouncedMqttChannelKeysPush(
  push: () => void,
  debounceMs: number,
): DebouncedMqttChannelKeysPush {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        push();
      }, debounceMs);
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
