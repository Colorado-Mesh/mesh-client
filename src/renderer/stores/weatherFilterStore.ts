import { create } from 'zustand';

import {
  getWeatherFilterSettings,
  isWeatherOnlinePlaceLookupEnabled,
  mergeAppSetting,
} from '../lib/appSettingsStorage';
import {
  loadWeatherMarkedSenders,
  saveWeatherMarkedSenders,
} from '../lib/chatPanelProtocolStorage';
import type { ChatMessage, MeshProtocol } from '../lib/types';
import {
  compileWeatherPattern,
  isChannelBroadcastMessage,
  isWeatherPost,
  type WeatherPostConfig,
} from '../lib/weatherPosts';

const PROTOCOLS: readonly MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum'];

interface WeatherFilterState {
  hideInChannels: boolean;
  pattern: string;
  /** True when `pattern` is non-empty but too long or not a valid regex (ignored). */
  patternInvalid: boolean;
  configs: Readonly<Record<MeshProtocol, WeatherPostConfig>>;
  /** Forecast places missing from the offline gazetteer may be looked up online. */
  onlinePlaceLookup: boolean;
  setHideInChannels: (hide: boolean) => void;
  setPattern: (pattern: string) => void;
  setSenderMarked: (protocol: MeshProtocol, senderId: number, marked: boolean) => void;
  setOnlinePlaceLookup: (enabled: boolean) => void;
}

function buildConfigs(
  customPattern: RegExp | null,
  senders: Readonly<Record<MeshProtocol, ReadonlySet<number>>>,
): Record<MeshProtocol, WeatherPostConfig> {
  const out = {} as Record<MeshProtocol, WeatherPostConfig>;
  for (const p of PROTOCOLS) out[p] = { customPattern, markedSenders: senders[p] };
  return out;
}

function initialState() {
  // Node-environment unit tests import chatUnreadCounts without a DOM storage.
  const storageAvailable = typeof window !== 'undefined';
  const { hideInChannels, pattern } = storageAvailable
    ? getWeatherFilterSettings()
    : { hideInChannels: false, pattern: '' };
  const compiled = compileWeatherPattern(pattern);
  const senders = {} as Record<MeshProtocol, ReadonlySet<number>>;
  for (const p of PROTOCOLS) {
    senders[p] = storageAvailable ? loadWeatherMarkedSenders(p) : new Set<number>();
  }
  return {
    hideInChannels,
    pattern,
    patternInvalid: compiled === 'invalid',
    configs: buildConfigs(compiled === 'invalid' ? null : compiled, senders),
    onlinePlaceLookup: storageAvailable ? isWeatherOnlinePlaceLookupEnabled() : false,
  };
}

function sendersOf(
  configs: Readonly<Record<MeshProtocol, WeatherPostConfig>>,
): Record<MeshProtocol, ReadonlySet<number>> {
  const out = {} as Record<MeshProtocol, ReadonlySet<number>>;
  for (const p of PROTOCOLS) out[p] = configs[p].markedSenders;
  return out;
}

export const useWeatherFilterStore = create<WeatherFilterState>()((set, get) => ({
  ...initialState(),
  setHideInChannels: (hideInChannels) => {
    mergeAppSetting('weatherFilterHideInChannels', hideInChannels, 'weatherFilterStore hide');
    set({ hideInChannels });
  },
  setPattern: (pattern) => {
    mergeAppSetting('weatherFilterPattern', pattern, 'weatherFilterStore pattern');
    const compiled = compileWeatherPattern(pattern);
    set({
      pattern,
      patternInvalid: compiled === 'invalid',
      configs: buildConfigs(compiled === 'invalid' ? null : compiled, sendersOf(get().configs)),
    });
  },
  setSenderMarked: (protocol, senderId, marked) => {
    const { configs } = get();
    const current = configs[protocol].markedSenders;
    if (current.has(senderId) === marked) return;
    const next = new Set(current);
    if (marked) next.add(senderId);
    else next.delete(senderId);
    saveWeatherMarkedSenders(protocol, next);
    set({
      configs: { ...configs, [protocol]: { ...configs[protocol], markedSenders: next } },
    });
  },
  setOnlinePlaceLookup: (onlinePlaceLookup) => {
    mergeAppSetting(
      'weatherOnlinePlaceLookup',
      onlinePlaceLookup,
      'weatherFilterStore onlinePlaceLookup',
    );
    set({ onlinePlaceLookup });
  },
}));

/**
 * True when `msg` is a channel weather post that the user chose to hide from channel views.
 * Unread counts and notifications use this so badges match what Chat shows.
 */
export function isHiddenWeatherPost(msg: ChatMessage, protocol: MeshProtocol): boolean {
  const state = useWeatherFilterStore.getState();
  if (!state.hideInChannels) return false;
  if (!isChannelBroadcastMessage(msg)) return false;
  return isWeatherPost(msg, state.configs[protocol]);
}
