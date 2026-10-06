import type { SettingSearchEntry, SettingsSearchSurface } from '../settingsSearch';

// Chat renders the Weather view (and these rows) only when it is not DM-only.
const hasWeatherView: SettingSearchEntry['visible'] = (ctx) =>
  !ctx.capabilities.hasReticulumInterfaceConfig;

const chatEntries: readonly SettingSearchEntry[] = [
  {
    id: 'chat.weather.hideInChannels',
    slot: 'Chat',
    labelKey: 'weatherFilter.hideInChannels',
    keywords: ['weather', 'bot', 'filter', 'hide'],
    visible: hasWeatherView,
  },
  {
    id: 'chat.weather.onlinePlaceLookup',
    slot: 'Chat',
    labelKey: 'weatherFilter.onlinePlaceLookup',
    keywords: ['weather', 'forecast', 'map', 'geocode', 'open-meteo', 'internet'],
    visible: hasWeatherView,
  },
  {
    id: 'chat.weather.pattern',
    slot: 'Chat',
    labelKey: 'weatherFilter.patternAria',
    keywords: ['weather', 'regex', 'pattern', 'filter'],
    visible: hasWeatherView,
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
