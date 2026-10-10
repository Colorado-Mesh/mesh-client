import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

const chatEntries: readonly SettingSearchEntry[] = [
  {
    id: 'chat.weather.hideInChannels',
    slot: 'Chat',
    labelKey: 'weatherFilter.hideInChannels',
    keywords: ['weather', 'bot', 'filter', 'hide'],
  },
  {
    id: 'chat.weather.onlinePlaceLookup',
    slot: 'Chat',
    labelKey: 'weatherFilter.onlinePlaceLookup',
    keywords: ['weather', 'forecast', 'map', 'geocode', 'open-meteo', 'internet'],
  },
  {
    id: 'chat.weather.pattern',
    slot: 'Chat',
    labelKey: 'weatherFilter.patternAria',
    keywords: ['weather', 'regex', 'pattern', 'filter'],
  },
];

export const chatSurface: SettingsSearchSurface = {
  entries: chatEntries,
  files: [{ path: 'src/renderer/components/chat/WeatherFilterSettings.tsx', sweepAllKeys: true }],
  exempt: {
    'weatherFilter.patternPlaceholder': 'placeholder of the indexed pattern field',
    'weatherFilter.patternInvalid': 'inline validation error',
    'weatherFilter.onlinePlaceLookupHint': 'hint for the indexed online lookup toggle',
  },
};
