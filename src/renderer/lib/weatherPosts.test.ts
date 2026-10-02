import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './types';
import {
  compileWeatherPattern,
  EMPTY_WEATHER_POST_CONFIG,
  isChannelBroadcastMessage,
  isWeatherPost,
  WEATHER_PATTERN_MAX_LENGTH,
  type WeatherPostConfig,
} from './weatherPosts';

function msg(payload: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 10,
    sender_name: 'Bot',
    payload,
    channel: 0,
    timestamp: 1,
    ...over,
  };
}

describe('isWeatherPost', () => {
  it.each([
    'Good morning Visalia: Clear. 60F now. Hi 93/Lo 65',
    '{"xiaomi1":{"temp":"66.7","hum":"69"}}',
    'Calgary 12°C light rain',
    'Tonight 45 ° F, wind NW',
    'NWS forecast: showers after 2pm',
    'Hi 71 / Lo 50, sunny',
  ])('matches issue-style weather post %j', (payload) => {
    expect(isWeatherPost(msg(payload), EMPTY_WEATHER_POST_CONFIG)).toBe(true);
  });

  it.each(['Anyone on LongFast tonight?', 'Fixed my antenna, 5 hops now', '{"ok":true}', ''])(
    'ignores ordinary chat %j',
    (payload) => {
      expect(isWeatherPost(msg(payload), EMPTY_WEATHER_POST_CONFIG)).toBe(false);
    },
  );

  it('matches every post from a marked sender', () => {
    const config: WeatherPostConfig = { customPattern: null, markedSenders: new Set([10]) };
    expect(isWeatherPost(msg('hello'), config)).toBe(true);
    expect(isWeatherPost(msg('hello', { sender_id: 11 }), config)).toBe(false);
  });

  it('matches the custom pattern case-insensitively', () => {
    const re = compileWeatherPattern('^wx-bot');
    expect(re).toBeInstanceOf(RegExp);
    const config: WeatherPostConfig = {
      customPattern: re as RegExp,
      markedSenders: new Set(),
    };
    expect(isWeatherPost(msg('WX-BOT: dry'), config)).toBe(true);
  });

  it('caches per message and config, and recomputes when the config changes', () => {
    const m = msg('hello');
    const a: WeatherPostConfig = { customPattern: null, markedSenders: new Set() };
    expect(isWeatherPost(m, a)).toBe(false);
    m.payload = 'forecast';
    expect(isWeatherPost(m, a)).toBe(false);
    const b: WeatherPostConfig = { customPattern: null, markedSenders: new Set() };
    expect(isWeatherPost(m, b)).toBe(true);
  });
});

describe('compileWeatherPattern', () => {
  it('returns null for empty input and invalid for bad or oversized patterns', () => {
    expect(compileWeatherPattern('   ')).toBeNull();
    expect(() => compileWeatherPattern('([')).not.toThrow();
    expect(compileWeatherPattern('([')).toBe('invalid');
    expect(compileWeatherPattern('a'.repeat(WEATHER_PATTERN_MAX_LENGTH + 1))).toBe('invalid');
  });
});

describe('isChannelBroadcastMessage', () => {
  it('excludes DMs and negative channels', () => {
    expect(isChannelBroadcastMessage({ channel: 0, to: undefined })).toBe(true);
    expect(isChannelBroadcastMessage({ channel: 0, to: 5 })).toBe(false);
    expect(isChannelBroadcastMessage({ channel: -1, to: undefined })).toBe(false);
  });
});
