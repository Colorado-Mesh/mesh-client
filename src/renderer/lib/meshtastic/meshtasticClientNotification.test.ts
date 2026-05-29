import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshtasticClientNotification,
  peekRecentMeshtasticClientNotification,
  recordMeshtasticClientNotification,
} from './meshtasticClientNotification';

describe('meshtasticClientNotification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearMeshtasticClientNotification();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMeshtasticClientNotification();
  });

  it('ignores blank notifications', () => {
    recordMeshtasticClientNotification('   ');
    expect(peekRecentMeshtasticClientNotification()).toBeNull();
  });

  it('returns trimmed message within the default window', () => {
    recordMeshtasticClientNotification('  MQTT invalid config  ');
    expect(peekRecentMeshtasticClientNotification()).toBe('MQTT invalid config');
  });

  it('expires notifications after withinMs', () => {
    recordMeshtasticClientNotification('stale');
    vi.advanceTimersByTime(8001);
    expect(peekRecentMeshtasticClientNotification()).toBeNull();
  });

  it('clearMeshtasticClientNotification removes pending detail', () => {
    recordMeshtasticClientNotification('detail');
    clearMeshtasticClientNotification();
    expect(peekRecentMeshtasticClientNotification()).toBeNull();
  });
});
