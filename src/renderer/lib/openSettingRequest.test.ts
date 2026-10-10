// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  OPEN_SETTING_REQUEST_EVENT,
  requestOpenSetting,
  subscribeOpenSettingRequests,
} from './openSettingRequest';

describe('openSettingRequest', () => {
  it('delivers requests to subscribers until unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenSettingRequests(listener);
    requestOpenSetting({ slot: 'App', id: 'app.appearance.reduceMotion' });
    expect(listener).toHaveBeenCalledWith({ slot: 'App', id: 'app.appearance.reduceMotion' });

    unsubscribe();
    requestOpenSetting({ slot: 'App', id: 'app.appearance.reduceMotion' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed events', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenSettingRequests(listener);
    window.dispatchEvent(new CustomEvent(OPEN_SETTING_REQUEST_EVENT));
    window.dispatchEvent(new CustomEvent(OPEN_SETTING_REQUEST_EVENT, { detail: { slot: 'App' } }));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
