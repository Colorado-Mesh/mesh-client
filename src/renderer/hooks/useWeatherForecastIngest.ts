import { useEffect } from 'react';

import { errLikeToLogString } from '../lib/errLikeToLogString';
import { getIdentityIdForProtocol } from '../lib/identityByProtocol';
import type { MeshProtocol } from '../lib/types';
import {
  type ForecastProtocolSnapshot,
  WeatherForecastIngestor,
} from '../lib/weatherForecastIngest';
import { getIdentity, useIdentityStore } from '../stores/identityStore';
import { useMessageStore } from '../stores/messageStore';
import { useNodeStore } from '../stores/nodeStore';
import { usePositionHistoryStore } from '../stores/positionHistoryStore';
import { useWeatherFilterStore } from '../stores/weatherFilterStore';
import { useWeatherForecastStore } from '../stores/weatherForecastStore';

/** LoRa protocols whose weather bots feed the shared forecast layer (shown on every map). */
export const WEATHER_FORECAST_SOURCE_PROTOCOLS: readonly MeshProtocol[] = [
  'meshtastic',
  'meshcore',
];
const SCAN_DEBOUNCE_MS = 500;

export function buildForecastSnapshots(): ForecastProtocolSnapshot[] {
  const { messages } = useMessageStore.getState();
  const { nodes } = useNodeStore.getState();
  const { history } = usePositionHistoryStore.getState();
  const { configs } = useWeatherFilterStore.getState();
  const trackedPosition = (nodeId: number) => {
    const last = history.get(nodeId)?.at(-1);
    return last ? { lat: last.lat, lon: last.lon } : null;
  };
  const out: ForecastProtocolSnapshot[] = [];
  for (const protocol of WEATHER_FORECAST_SOURCE_PROTOCOLS) {
    const identityId = getIdentityIdForProtocol(protocol);
    if (!identityId) continue;
    out.push({
      protocol,
      messages: messages[identityId],
      nodes: nodes[identityId],
      markedSenders: configs[protocol].markedSenders,
      selfNodeNum: getIdentity(identityId)?.selfNodeNum,
      trackedPosition,
    });
  }
  return out;
}

/**
 * Mount once from App: places forecasts from marked weather senders on Meshtastic and MeshCore
 * into the global forecast store, regardless of the active tab.
 */
export function useWeatherForecastIngest(): void {
  useEffect(() => {
    const store = useWeatherForecastStore.getState();
    const ingestor = new WeatherForecastIngestor({
      now: Date.now,
      allowOnline: () => useWeatherFilterStore.getState().onlinePlaceLookup,
      resolvePlace: (request) =>
        window.electronAPI.geo?.resolvePlace(request) ?? Promise.resolve(null),
      upsert: (entry) => {
        store.upsertForecast(entry);
      },
      appendSegments: store.appendSegments,
      completeIssued: store.completeIssued,
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runScan = () => {
      timer = null;
      ingestor.scan(buildForecastSnapshots()).catch((err: unknown) => {
        console.warn('[useWeatherForecastIngest] scan failed ' + errLikeToLogString(err));
      });
    };
    const schedule = () => {
      timer ??= setTimeout(runScan, SCAN_DEBOUNCE_MS);
    };
    runScan();
    const unsubs = [
      useMessageStore.subscribe((s, prev) => {
        if (s.messages !== prev.messages) schedule();
      }),
      useIdentityStore.subscribe((s, prev) => {
        if (s.identities !== prev.identities || s.activeIdentityId !== prev.activeIdentityId) {
          schedule();
        }
      }),
      useWeatherFilterStore.subscribe((s, prev) => {
        if (s.configs !== prev.configs) schedule();
      }),
    ];
    return () => {
      if (timer != null) clearTimeout(timer);
      for (const unsub of unsubs) unsub();
    };
  }, []);
}
