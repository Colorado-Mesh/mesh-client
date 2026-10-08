import { beforeEach, describe, expect, it } from 'vitest';

import {
  isMecpAlertThrottled,
  MECP_ALERT_FLOOD_MAX_SENDERS,
  MECP_ALERT_FLOOD_WINDOW_MS,
  MECP_ALERT_THROTTLE_MAX,
  MECP_ALERT_THROTTLE_WINDOW_MS,
  recordMecpAlert,
  resetMecpAlertThrottleForTests,
} from './mecpAlertThrottle';

const T0 = 1_000_000;

describe('mecpAlertThrottle', () => {
  beforeEach(() => {
    resetMecpAlertThrottleForTests();
  });

  it('allows the first alerts from a sender, then suppresses and notifies once', () => {
    for (let i = 0; i < MECP_ALERT_THROTTLE_MAX; i++) {
      expect(recordMecpAlert('meshtastic:9', T0 + i)).toEqual({ alert: true, notify: null });
    }
    expect(isMecpAlertThrottled('meshtastic:9', T0 + 10)).toBe(true);
    expect(recordMecpAlert('meshtastic:9', T0 + 10)).toEqual({ alert: false, notify: 'sender' });
    expect(recordMecpAlert('meshtastic:9', T0 + 11)).toEqual({ alert: false, notify: null });
  });

  it('keeps senders independent and protocols separate', () => {
    for (let i = 0; i < MECP_ALERT_THROTTLE_MAX; i++) recordMecpAlert('meshtastic:9', T0 + i);
    expect(recordMecpAlert('meshcore:9', T0 + 5).alert).toBe(true);
    expect(recordMecpAlert('meshtastic:10', T0 + 5).alert).toBe(true);
  });

  it('re-arms after the sliding window passes', () => {
    for (let i = 0; i < MECP_ALERT_THROTTLE_MAX + 2; i++) recordMecpAlert('meshtastic:9', T0 + i);
    const later = T0 + MECP_ALERT_THROTTLE_WINDOW_MS + MECP_ALERT_THROTTLE_MAX + 5;
    expect(isMecpAlertThrottled('meshtastic:9', later)).toBe(false);
    expect(recordMecpAlert('meshtastic:9', later).alert).toBe(true);
  });

  it('pauses tones during a multi-sender flood with a single flood notice', () => {
    for (let i = 0; i < MECP_ALERT_FLOOD_MAX_SENDERS; i++) {
      expect(recordMecpAlert(`meshtastic:${i + 100}`, T0 + i).alert).toBe(true);
    }
    expect(recordMecpAlert('meshtastic:200', T0 + 10)).toEqual({ alert: false, notify: 'flood' });
    expect(recordMecpAlert('meshtastic:201', T0 + 11)).toEqual({ alert: false, notify: null });
    const after = T0 + 11 + MECP_ALERT_FLOOD_WINDOW_MS + 1;
    expect(recordMecpAlert('meshtastic:300', after).alert).toBe(true);
  });
});
