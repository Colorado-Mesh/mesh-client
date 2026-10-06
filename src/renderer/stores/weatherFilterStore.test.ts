import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_SETTINGS_STORAGE_KEY,
  isWeatherOnlinePlaceLookupEnabled,
} from '../lib/appSettingsStorage';
import { loadWeatherMarkedSenders } from '../lib/chatPanelProtocolStorage';
import {
  computeChannelUnreadCounts,
  pickAudibleNotification,
  resolveChatNotificationType,
} from '../lib/chatUnreadCounts';
import type { ChatMessage } from '../lib/types';
import { isHiddenWeatherPost, useWeatherFilterStore } from './weatherFilterStore';
import { useWeatherForecastStore, type WeatherForecastEntry } from './weatherForecastStore';

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

  it('keeps online place lookup off by default and persists the toggle', () => {
    expect(useWeatherFilterStore.getState().onlinePlaceLookup).toBe(false);
    expect(isWeatherOnlinePlaceLookupEnabled()).toBe(false);
    useWeatherFilterStore.getState().setOnlinePlaceLookup(true);
    expect(useWeatherFilterStore.getState().onlinePlaceLookup).toBe(true);
    expect(isWeatherOnlinePlaceLookupEnabled()).toBe(true);
    useWeatherFilterStore.getState().setOnlinePlaceLookup(false);
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

  it('does not raise a reply notification for a hidden weather reply to an own message', () => {
    const parent = msg('what is the weather?', {
      sender_id: 1,
      packetId: 77,
      timestamp: Date.now() - 5000,
    });
    const reply = msg('Clear. 60F now.', { replyId: 77 });
    const all = [parent, reply];
    expect(resolveChatNotificationType(reply, all, OWN, 'meshtastic')).toBe('reply');

    useWeatherFilterStore.getState().setHideInChannels(true);
    expect(resolveChatNotificationType(reply, all, OWN, 'meshtastic')).toBeNull();
    expect(pickAudibleNotification([reply], 'meshtastic', new Set(), OWN, undefined, all)).toBe(
      null,
    );
  });

  it('drops that sender forecasts when the sender is unmarked', () => {
    const forecast = (
      key: string,
      protocol: WeatherForecastEntry['protocol'],
      senderId: number,
    ): WeatherForecastEntry => ({
      key,
      lat: 1,
      lon: 2,
      positionSource: 'senderApprox',
      profileId: 'nwsPipe',
      period: 'Tonight',
      summary: 'Clear',
      segments: ['Tonight: 59°F Clear'],
      hasAlerts: false,
      receivedAt: Date.now(),
      protocol,
      senderId,
      messageId: key,
    });
    const { upsertForecast } = useWeatherForecastStore.getState();
    upsertForecast(forecast('place:bot', 'meshcore', 42));
    upsertForecast(forecast('place:other', 'meshcore', 7));
    upsertForecast(forecast('place:other-protocol', 'meshtastic', 42));
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 42, true);
    expect(useWeatherForecastStore.getState().entries['place:bot']).toBeDefined();
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 42, false);
    const entries = useWeatherForecastStore.getState().entries;
    expect(entries['place:bot']).toBeUndefined();
    expect(entries['place:other']).toBeDefined();
    expect(entries['place:other-protocol']).toBeDefined();
    useWeatherForecastStore.getState().clearForecasts();
  });

  it('treats a marked sender as weather on that protocol only', () => {
    useWeatherFilterStore.getState().setHideInChannels(true);
    useWeatherFilterStore.getState().setSenderMarked('meshcore', 10, true);
    const post = msg('Good morning everyone');
    expect(isHiddenWeatherPost(post, 'meshcore')).toBe(true);
    expect(isHiddenWeatherPost(post, 'meshtastic')).toBe(false);
  });
});
