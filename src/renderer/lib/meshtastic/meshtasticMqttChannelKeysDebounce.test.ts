import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_MQTT_CHANNEL_KEYS_DEBOUNCE_MS } from '../../lib/timeConstants';
import { createDebouncedMqttChannelKeysPush } from './meshtasticMqttChannelKeysDebounce';

describe('createDebouncedMqttChannelKeysPush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces two schedules into one push with latest closed-over entries', () => {
    const updateChannelKeys = vi.fn();
    let entries = [
      { name: 'OnTrail', pskBase64: 'AA==', index: 0 },
      { name: 'LongFast', pskBase64: 'AQ==', index: 1 },
    ];
    const debouncer = createDebouncedMqttChannelKeysPush(() => {
      updateChannelKeys({ entries: [...entries] });
    }, MESHTASTIC_MQTT_CHANNEL_KEYS_DEBOUNCE_MS);

    debouncer.schedule();
    entries = [{ name: 'OnTrail', pskBase64: 'AA==', index: 0 }];
    debouncer.schedule();

    expect(updateChannelKeys).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MESHTASTIC_MQTT_CHANNEL_KEYS_DEBOUNCE_MS);
    expect(updateChannelKeys).toHaveBeenCalledTimes(1);
    expect(updateChannelKeys).toHaveBeenCalledWith({
      entries: [{ name: 'OnTrail', pskBase64: 'AA==', index: 0 }],
    });
  });

  it('cancel before fire prevents IPC-style push (unmount while timer pending)', () => {
    const updateChannelKeys = vi.fn();
    const debouncer = createDebouncedMqttChannelKeysPush(() => {
      updateChannelKeys({ entries: [{ name: 'LongFast', pskBase64: 'AQ==', index: 1 }] });
    }, MESHTASTIC_MQTT_CHANNEL_KEYS_DEBOUNCE_MS);

    debouncer.schedule();
    debouncer.cancel();
    vi.advanceTimersByTime(MESHTASTIC_MQTT_CHANNEL_KEYS_DEBOUNCE_MS);
    expect(updateChannelKeys).not.toHaveBeenCalled();
  });
});
