import type { ChatMessage } from '@/renderer/lib/types';

/** Longest user pattern accepted; longer input is treated as invalid. */
export const WEATHER_PATTERN_MAX_LENGTH = 200;

/**
 * Bot-style weather posts seen on public channels, e.g.
 * "Good morning Visalia: Clear. 60F now. Hi 93/Lo 65" or `{"xiaomi1":{"temp":"66.7","hum":"69"}}`.
 */
const DEFAULT_WEATHER_PATTERNS: readonly RegExp[] = [
  /\d\s*°\s*[FC]\b/i,
  /\d\s*F\s+now\b/i,
  /\bforecast\b/i,
  /\bHi\s*-?\d+\s*\/\s*Lo\s*-?\d+/i,
  /^\s*\{[\s\S]*"(?:temp|hum)[a-z]*"\s*:/i,
];

export interface WeatherPostConfig {
  /** Compiled user pattern; null when empty or invalid. */
  customPattern: RegExp | null;
  markedSenders: ReadonlySet<number>;
}

export const EMPTY_WEATHER_POST_CONFIG: WeatherPostConfig = Object.freeze({
  customPattern: null,
  markedSenders: new Set<number>(),
});

/**
 * Compile a user weather pattern (case-insensitive). Returns null for empty input and
 * `'invalid'` when the pattern is too long or not a valid regular expression.
 */
export function compileWeatherPattern(pattern: string): RegExp | null | 'invalid' {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (trimmed.length > WEATHER_PATTERN_MAX_LENGTH) return 'invalid';
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- user's own local chat filter, length-capped
    return new RegExp(trimmed, 'i');
  } catch {
    // catch-no-log-ok invalid user regex is surfaced inline in the weather settings
    return 'invalid';
  }
}

const cache = new WeakMap<ChatMessage, { config: WeatherPostConfig; value: boolean }>();

function matchWeatherPost(msg: ChatMessage, config: WeatherPostConfig): boolean {
  if (config.markedSenders.has(msg.sender_id)) return true;
  const text = msg.payload;
  if (!text) return false;
  if (config.customPattern?.test(text)) return true;
  return DEFAULT_WEATHER_PATTERNS.some((re) => re.test(text));
}

/** True when `msg` looks like a weather post (default patterns, custom pattern, or marked sender). */
export function isWeatherPost(msg: ChatMessage, config: WeatherPostConfig): boolean {
  const hit = cache.get(msg);
  if (hit?.config === config) return hit.value;
  const value = matchWeatherPost(msg, config);
  cache.set(msg, { config, value });
  return value;
}

/** Broadcast channel traffic (not DMs), where the weather filter applies. */
export function isChannelBroadcastMessage(msg: Pick<ChatMessage, 'to' | 'channel'>): boolean {
  return !msg.to && msg.channel >= 0;
}
