import { beforeEach, describe, expect, it } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '../lib/appSettingsStorage';
import { loadWeatherMarkedSenders } from '../lib/chatPanelProtocolStorage';
import {
  computeChannelUnreadCounts,
  pickAudibleNotification,
  resolveChatNotificationType,
} from '../lib/chatUnreadCounts';
import type { ChatMessage } from '../lib/types';
import { isHiddenWeatherPost, useWeatherFilterStore } from './weatherFilterStore';

const OWN = new Set([1]);

function msg(payload: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 10,
    sender_name: 'Bot',
    payload,
    channel: 0,
    timestamp: Date.now() - 1000,
    ...over,
  };
}

describe('weatherFilterStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useWeatherFilterStore.getState().setHideInChannels(false);
    useWeatherFilterStore.getState().setPattern('');
    for (const p of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      for (const id of useWeatherFilterStore.getState().configs[p].markedSenders) {
        useWeatherFilterStore.getState().setSenderMarked(p, id, false);
      }
    }
  });

  it('persists hide-in-channels and pattern to app settings', () => {
    useWeatherFilterStore.getState().setHideInChannels(true);
    useWeatherFilterStore.getState().setPattern('^WX');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.weatherFilterHideInChannels).toBe(true);
    expect(parsed.weatherFilterPattern).toBe('^WX');
    expect(useWeatherFilterStore.getState().patternInvalid).toBe(false);
  });

  it('flags an invalid pattern and ignores it', () => {
    useWeatherFilterStore.getState().setPattern('([');
    expect(useWeatherFilterStore.getState().patternInvalid).toBe(true);
    expect(useWeatherFilterStore.getState().configs.meshtastic.customPattern).toBeNull();
  });

  it('marks senders per protocol and persists them', () => {
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 42, true);
    expect(useWeatherFilterStore.getState().configs.meshcore.markedSenders.has(42)).toBe(true);
    expect(useWeatherFilterStore.getState().configs.meshtastic.markedSenders.has(42)).toBe(false);
    expect(loadWeatherMarkedSenders('meshcore').has(42)).toBe(true);
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 42, false);
    expect(loadWeatherMarkedSenders('meshcore').has(42)).toBe(false);
  });

  it('hides only channel weather posts, and only while hiding is on', () => {
    const weather = msg('60F now. Hi 93/Lo 65');
    const dm = msg('60F now', { to: 1 });
    expect(isHiddenWeatherPost(weather, 'meshtastic')).toBe(false);
    useWeatherFilterStore.getState().setHideInChannels(true);
    expect(isHiddenWeatherPost(weather, 'meshtastic')).toBe(true);
    expect(isHiddenWeatherPost(dm, 'meshtastic')).toBe(false);
  });

  it('keeps hidden weather posts out of channel unread counts and notifications', () => {
    const weather = msg('Clear. 60F now.');
    const chat = msg('anyone around?', { sender_id: 11 });
    const all = [weather, chat];
    const countBefore = computeChannelUnreadCounts(all, {}, OWN, 'meshtastic').get(0);
    expect(countBefore).toBe(2);

    useWeatherFilterStore.getState().setHideInChannels(true);
    expect(computeChannelUnreadCounts(all, {}, OWN, 'meshtastic').get(0)).toBe(1);
    expect(resolveChatNotificationType(weather, all, OWN, 'meshtastic')).toBeNull();
    expect(resolveChatNotificationType(chat, all, OWN, 'meshtastic')).toBe('channel');
    expect(pickAudibleNotification([weather], 'meshtastic', new Set(), OWN)).toBeNull();
  });

  it('treats a marked sender as weather on that protocol only', () => {
    useWeatherFilterStore.getState().setHideInChannels(true);
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 10, true);
    const post = msg('Good morning everyone');
    expect(isHiddenWeatherPost(post, 'meshcore')).toBe(true);
    expect(isHiddenWeatherPost(post, 'meshtastic')).toBe(false);
  });
});
